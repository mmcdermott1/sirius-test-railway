import passport from "passport";
import { Strategy as SamlStrategy, type Profile } from "@node-saml/passport-saml";
import type { Express, RequestHandler, Request, Response, NextFunction } from "express";
import type { AuthProvider, SamlProviderConfig, AuthenticatedUser } from "../types";
import { storage } from "../../storage";
import { storageLogger, logger } from "../../logger";
import { getRequestContext } from "../../middleware/request-context";
import { getEnvironmentVariable } from "../../config/env-registry";

const STRATEGY_NAME = "saml";

/**
 * Map common node-saml validation errors to a human-readable reason an
 * administrator can act on without server-log access. Falls back to the raw
 * message (which contains no assertion contents — node-saml messages are
 * short diagnostics).
 */
function categorizeSamlError(message: string): { category: string; reason: string } {
  const m = message.toLowerCase();
  if (m.includes("audience")) {
    return { category: "audience_mismatch", reason: "Audience mismatch: the identity provider's Audience URI (SP Entity ID) does not match this application's issuer. Make both sides identical." };
  }
  if (m.includes("signature")) {
    return { category: "invalid_signature", reason: "Signature validation failed: the response/assertion signature does not verify against the configured IdP certificate, or a required signature is missing. Check the certificate pasted in SAML_CERT and that the IdP signs the assertion." };
  }
  if (m.includes("cert")) {
    return { category: "certificate_problem", reason: "Certificate problem: the configured IdP signing certificate is missing or invalid (SAML_CERT)." };
  }
  if (m.includes("expired") || m.includes("not yet valid") || m.includes("notbefore")) {
    return { category: "assertion_timing", reason: "Assertion timing rejected (expired or not yet valid): usually clock skew between the identity provider and this server, or a stale/replayed response." };
  }
  if (m.includes("recipient") || m.includes("destination")) {
    return { category: "recipient_mismatch", reason: "Recipient/Destination mismatch: the identity provider is posting to a different callback URL than this application expects. The Single sign-on (ACS) URL must exactly match the application's callback URL." };
  }
  if (m.includes("inresponseto")) {
    return { category: "in_response_to", reason: "InResponseTo validation failed: the response does not match an outstanding login request (IdP-initiated flow or an expired login attempt)." };
  }
  if (m.includes("missing") && m.includes("assertion")) {
    return { category: "missing_assertion", reason: "The sign-in response contained no SAML assertion (malformed or truncated response from the identity provider)." };
  }
  if (m.includes("status")) {
    return { category: "idp_status_error", reason: "The identity provider returned a non-success SAML status. Check the IdP-side assignment/configuration for this user and application." };
  }
  return { category: "unrecognized", reason: "Unrecognized SAML error — see the redacted diagnostic in the log entry's metadata." };
}

/**
 * Bounded, redacted diagnostic for the "unrecognized" bucket. The raw message
 * can incorporate IdP-controlled text (e.g. SamlStatusError embeds the IdP's
 * StatusMessage), so emails and long digit runs are masked and the result is
 * truncated before it is persisted.
 */
function redactDiagnostic(message: string): string {
  return message
    .replace(/[^\s@<>"']+@[^\s@<>"']+\.[^\s@<>"']+/g, "[email]")
    .replace(/\d{5,}/g, "[digits]")
    .slice(0, 300);
}

/**
 * Persist a sanitized SAML failure so admins can diagnose IdP configuration
 * problems from the in-app log viewer (Config → Logs, module "auth"), and
 * return a short reference id surfaced on the public error page.
 */
function recordSamlFailure(operation: string, error: unknown, req: Request): string {
  const reference = `SAML-${Date.now().toString(36).toUpperCase()}-${Math.random().toString(36).slice(2, 6).toUpperCase()}`;
  const err = error instanceof Error ? error : new Error(String(error));
  const reason = humanizeSamlError(err.message || "Unknown error");
  const context = getRequestContext();
  storageLogger.error(`SAML sign-in failure [${reference}]`, {
    module: "auth",
    operation,
    description: reason,
    ip_address: context?.ipAddress ?? req.ip,
    // Raw diagnostics land in meta (shown in the log detail dialog).
    reference,
    errorName: err.name,
    errorMessage: err.message,
  });
  return reference;
}

interface SamlProfile {
  nameID?: string;
  nameIDFormat?: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
  [key: string]: unknown;
}

function extractProfileData(profile: SamlProfile): {
  externalId: string;
  email?: string;
  firstName?: string;
  lastName?: string;
  displayName?: string;
} {
  const externalId = profile.nameID || profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/nameidentifier"] as string;
  
  const email = 
    profile.email ||
    profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"] as string ||
    profile.nameID;
  
  const firstName = 
    profile.firstName ||
    profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"] as string ||
    profile["User.FirstName"] as string;
  
  const lastName = 
    profile.lastName ||
    profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname"] as string ||
    profile["User.LastName"] as string;
  
  const displayName = 
    profile.displayName ||
    profile["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/name"] as string ||
    (firstName && lastName ? `${firstName} ${lastName}` : undefined);

  return { externalId, email, firstName, lastName, displayName };
}

async function checkUserAccess(
  profile: SamlProfile
): Promise<{ allowed: boolean; user?: any }> {
  const { externalId, email, firstName, lastName, displayName } = extractProfileData(profile);

  logger.info("SAML Auth attempt", {
    service: "saml-auth",
    externalId,
    email,
    firstName,
    lastName,
  });

  if (!externalId) {
    logger.warn("SAML profile missing nameID", { profile });
    return { allowed: false };
  }

  let identity = await storage.authIdentities.getByProviderAndExternalId("saml", externalId);

  if (identity) {
    const user = await storage.users.getUser(identity.userId);
    if (!user) {
      logger.warn("SAML auth identity found but user missing", { identityId: identity.id });
      return { allowed: false };
    }

    if (!user.isActive) {
      logger.info("User account is inactive", { userId: user.id });
      return { allowed: false };
    }

    await storage.authIdentities.update(identity.id, {
      email,
      displayName,
    });
    await storage.authIdentities.updateLastUsed(identity.id);

    const updatedUser = await storage.users.updateUser(user.id, {
      email,
      firstName,
      lastName,
    });

    await storage.users.updateUserLastLogin(user.id);
    logLoginEvent(updatedUser, externalId, false);

    return { allowed: true, user: updatedUser };
  }

  if (!email) {
    logger.info("SAML profile missing email, cannot link account", { externalId });
    return { allowed: false };
  }

  const user = await storage.users.getUserByEmail(email);

  if (!user) {
    logger.info("No provisioned account found for SAML email", { email });
    return { allowed: false };
  }

  if (!user.isActive) {
    logger.info("User account is inactive", { userId: user.id });
    return { allowed: false };
  }

  logger.info("Linking SAML account to provisioned user", { userId: user.id, email });

  await storage.authIdentities.create({
    userId: user.id,
    providerType: "saml",
    externalId,
    email,
    displayName,
  });

  const linkedUser = await storage.users.updateUser(user.id, {
    email,
    firstName,
    lastName,
    accountStatus: "linked",
  });

  await storage.users.updateUserLastLogin(user.id);
  logLoginEvent(linkedUser, externalId, true);

  return { allowed: true, user: linkedUser };
}

function logLoginEvent(user: any, externalId: string, accountLinked: boolean) {
  const userName =
    user.firstName && user.lastName
      ? `${user.firstName} ${user.lastName}`
      : user.email;

  setImmediate(() => {
    const context = getRequestContext();
    storageLogger.info("Authentication event: login", {
      module: "auth",
      operation: "login",
      entityType: "user",
      entityId: user.id,
      details: {
        provider: "saml",
        externalId,
        userName,
        accountLinked,
      },
      request: context
        ? {
            userId: context.userId,
            ip: context.ipAddress,
          }
        : undefined,
    });
  });
}

class SamlAuthProvider implements AuthProvider {
  type = "saml" as const;
  private config: SamlProviderConfig;
  private callbackUrl: string = "";

  constructor(config: SamlProviderConfig) {
    this.config = config;
  }

  async setup(app: Express): Promise<void> {
    const host = getEnvironmentVariable("REPLIT_DEV_DOMAIN") || getEnvironmentVariable("REPL_SLUG") + "." + getEnvironmentVariable("REPL_OWNER") + ".repl.co";
    const protocol = "https";
    this.callbackUrl = `${protocol}://${host}${this.config.callbackPath || "/api/auth/saml/callback"}`;

    const samlStrategy = new SamlStrategy(
      {
        entryPoint: this.config.entryPoint,
        issuer: this.config.issuer || `${protocol}://${host}`,
        idpCert: this.config.cert,
        callbackUrl: this.callbackUrl,
        wantAuthnResponseSigned: false,
        wantAssertionsSigned: true,
        signatureAlgorithm: "sha256",
        identifierFormat: "urn:oasis:names:tc:SAML:1.1:nameid-format:emailAddress",
      },
      (profile: Profile | null, done: (err: Error | null, user?: Record<string, unknown>) => void) => {
        (async () => {
          try {
            if (!profile) {
              return done(null, undefined);
            }
            
            const samlProfile = profile as unknown as SamlProfile;
            const { allowed, user } = await checkUserAccess(samlProfile);

            if (!allowed) {
              return done(null, undefined);
            }

            const { externalId, email, firstName, lastName } = extractProfileData(samlProfile);

            const sessionUser: AuthenticatedUser = {
              claims: {
                sub: externalId,
                email,
                first_name: firstName,
                last_name: lastName,
              },
              dbUser: user,
              providerType: "saml",
            };

            return done(null, sessionUser as unknown as Record<string, unknown>);
          } catch (error) {
            logger.error("SAML authentication error", { error });
            return done(error as Error);
          }
        })();
      },
      (profile: Profile | null, done: (err: Error | null, user?: Record<string, unknown>) => void) => {
        if (!profile) {
          return done(null, undefined);
        }
        const samlProfile = profile as unknown as SamlProfile;
        const { externalId, email, firstName, lastName } = extractProfileData(samlProfile);
        
        const sessionUser: AuthenticatedUser = {
          claims: {
            sub: externalId,
            email,
            first_name: firstName,
            last_name: lastName,
          },
          providerType: "saml",
        };
        return done(null, sessionUser as unknown as Record<string, unknown>);
      }
    );

    passport.use(STRATEGY_NAME, samlStrategy);

    const callbackPath = this.config.callbackPath || "/api/auth/saml/callback";
    app.post(callbackPath, this.getCallbackHandler());
    // The ACS only accepts SAML assertions via POST. Browsers still arrive
    // here with GET — Okta "Embed link" apps, bookmarked callback URLs, or a
    // redirect-binding misconfiguration — and without this handler the GET
    // fell through to the SPA catch-all and rendered a bare 404 page. Kick
    // those into the normal SP-initiated login instead: it round-trips
    // through the IdP and comes back as a proper POST.
    app.get(callbackPath, (req, res) => {
      if (req.isAuthenticated?.()) return res.redirect("/");
      // An IdP misconfigured to use the Redirect binding delivers its
      // response as GET ?SAMLResponse=... — bouncing that to login would
      // loop forever (login → IdP → same GET). Terminal error instead.
      if (typeof req.query.SAMLResponse === "string") {
        logger.warn("SAML response received via GET (Redirect binding); ACS requires POST", {
          service: "saml-auth",
        });
        return res.redirect("/auth-error?error=saml_wrong_binding");
      }
      logger.info("GET on SAML callback path; redirecting to SP-initiated login", {
        service: "saml-auth",
      });
      res.redirect("/api/auth/saml/login");
    });

    app.get("/api/auth/saml/metadata", (req, res) => {
      res.type("application/xml");
      const metadata = `<?xml version="1.0"?>
<EntityDescriptor xmlns="urn:oasis:names:tc:SAML:2.0:metadata" entityID="${this.config.issuer || `${protocol}://${host}`}">
  <SPSSODescriptor protocolSupportEnumeration="urn:oasis:names:tc:SAML:2.0:protocol">
    <AssertionConsumerService Binding="urn:oasis:names:tc:SAML:2.0:bindings:HTTP-POST" Location="${this.callbackUrl}" index="0"/>
  </SPSSODescriptor>
</EntityDescriptor>`;
      res.send(metadata);
    });

    app.get("/api/auth/saml/login", this.getLoginHandler());

    logger.info("SAML auth provider initialized", {
      service: "saml-auth",
      entryPoint: this.config.entryPoint,
      callbackUrl: this.callbackUrl,
    });
  }

  getLoginHandler(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      const redirectPath = req.query.redirect as string || "/";
      
      passport.authenticate(STRATEGY_NAME, {
        additionalParams: {},
      } as any)(req, res, next);
    };
  }

  getCallbackHandler(): RequestHandler {
    return (req: Request, res: Response, next: NextFunction) => {
      passport.authenticate(STRATEGY_NAME, {
        failureRedirect: "/auth-error?error=saml_failed",
        session: true,
      })(req, res, (err: any) => {
        if (err) {
          logger.error("SAML callback error", { error: err });
          const reference = recordSamlFailure("saml_callback_failed", err, req);
          return res.redirect(`/auth-error?error=saml_callback_failed&ref=${reference}`);
        }

        if (!req.user) {
          return res.redirect("/auth-error?error=access_denied");
        }

        req.login(req.user, (loginErr) => {
          if (loginErr) {
            logger.error("SAML session login error", { error: loginErr });
            const reference = recordSamlFailure("session_failed", loginErr, req);
            return res.redirect(`/auth-error?error=session_failed&ref=${reference}`);
          }

          res.redirect("/");
        });
      });
    };
  }

  getLogoutHandler(): RequestHandler {
    return async (req: Request, res: Response) => {
      const user = req.user as AuthenticatedUser | undefined;

      if (user) {
        logger.info("SAML logout", {
          service: "saml-auth",
          userId: user.dbUser?.id,
          externalId: user.claims?.sub,
        });
      }

      req.logout((err) => {
        if (err) {
          logger.error("SAML logout error", { error: err });
        }

        req.session?.destroy((sessionErr) => {
          if (sessionErr) {
            logger.error("Session destruction error", { error: sessionErr });
          }
          res.redirect("/");
        });
      });
    };
  }
}

export function createProvider(config: SamlProviderConfig): AuthProvider {
  return new SamlAuthProvider(config);
}

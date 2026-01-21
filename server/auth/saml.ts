import { Strategy as SamlStrategy, Profile } from "@node-saml/passport-saml";
import passport from "passport";
import type { Express, RequestHandler } from "express";
import { storage } from "../storage";
import { logger, storageLogger } from "../logger";
import { getRequestContext } from "../middleware/request-context";
import type { AuthProviderType } from "@shared/schema";

const PROVIDER_TYPE: AuthProviderType = "saml";

interface SamlConfig {
  entryPoint: string;
  issuer: string;
  callbackUrl: string;
  cert: string;
  privateCert?: string;
  identifierFormat?: string;
}

function getSamlConfig(): SamlConfig | null {
  const entryPoint = process.env.SAML_ENTRY_POINT;
  const issuer = process.env.SAML_ISSUER;
  const callbackUrl = process.env.SAML_CALLBACK_URL;
  const cert = process.env.SAML_IDP_CERT;

  if (!entryPoint || !issuer || !callbackUrl || !cert) {
    return null;
  }

  return {
    entryPoint,
    issuer,
    callbackUrl,
    cert: cert.replace(/\\n/g, "\n"),
    privateCert: process.env.SAML_SP_PRIVATE_KEY?.replace(/\\n/g, "\n"),
    identifierFormat: process.env.SAML_IDENTIFIER_FORMAT || undefined,
  };
}

async function checkUserAccess(
  profile: Profile
): Promise<{ allowed: boolean; user?: any; providerType: AuthProviderType }> {
  const externalId = profile.nameID;
  const email = (profile.email as string | undefined) || (profile as any)["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/emailaddress"];
  const firstName = (profile.firstName as string | undefined) || (profile as any)["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/givenname"];
  const lastName = (profile.lastName as string | undefined) || (profile as any)["http://schemas.xmlsoap.org/ws/2005/05/identity/claims/surname"];
  const displayName = typeof profile.displayName === "string" ? profile.displayName : undefined;

  if (!externalId || !email) {
    logger.warn("SAML profile missing required fields", {
      source: "auth",
      hasNameID: !!externalId,
      hasEmail: !!email,
    });
    return { allowed: false, providerType: PROVIDER_TYPE };
  }

  const existingIdentity = await storage.authIdentities.getByProviderAndExternalId(PROVIDER_TYPE, externalId);

  if (existingIdentity) {
    const existingUser = await storage.users.getUser(existingIdentity.userId);
    if (!existingUser) {
      logger.error("SAML auth identity exists but user not found", {
        source: "auth",
        identityId: existingIdentity.id,
        userId: existingIdentity.userId,
      });
      return { allowed: false, providerType: PROVIDER_TYPE };
    }

    if (!existingUser.isActive) {
      logger.warn("SAML login attempt by inactive user", {
        source: "auth",
        userId: existingUser.id,
        email: existingUser.email,
      });
      return { allowed: false, providerType: PROVIDER_TYPE };
    }

    await storage.authIdentities.updateLastUsed(existingIdentity.id);

    const updatedUser = await storage.users.updateUser(existingUser.id, {
      firstName: firstName || displayName?.split(" ")[0] || existingUser.firstName,
      lastName: lastName || displayName?.split(" ").slice(1).join(" ") || existingUser.lastName,
    });

    const context = getRequestContext();
    storageLogger.info("Authentication event: login", {
      module: "auth",
      operation: "login",
      entity_id: existingUser.id,
      description: `User logged in via SAML: ${existingUser.email}`,
      user_id: existingUser.id,
      user_email: existingUser.email,
      ip_address: context?.ipAddress,
      meta: {
        userId: existingUser.id,
        email: existingUser.email,
        providerType: PROVIDER_TYPE,
      },
    });

    return { allowed: true, user: updatedUser || existingUser, providerType: PROVIDER_TYPE };
  }

  let existingUser = await storage.users.getUserByEmail(email);

  if (existingUser) {
    if (!existingUser.isActive) {
      logger.warn("SAML login attempt by inactive user (email match)", {
        source: "auth",
        userId: existingUser.id,
        email: existingUser.email,
      });
      return { allowed: false, providerType: PROVIDER_TYPE };
    }

    await storage.authIdentities.create({
      userId: existingUser.id,
      providerType: PROVIDER_TYPE,
      externalId,
      email,
      displayName: displayName || `${firstName} ${lastName}`.trim(),
    });

    const updatedUser = await storage.users.updateUser(existingUser.id, {
      firstName: firstName || displayName?.split(" ")[0] || existingUser.firstName,
      lastName: lastName || displayName?.split(" ").slice(1).join(" ") || existingUser.lastName,
    });

    const context = getRequestContext();
    storageLogger.info("Authentication event: login (SAML identity linked)", {
      module: "auth",
      operation: "login",
      entity_id: existingUser.id,
      description: `User logged in via SAML (new identity linked): ${existingUser.email}`,
      user_id: existingUser.id,
      user_email: existingUser.email,
      ip_address: context?.ipAddress,
      meta: {
        userId: existingUser.id,
        email: existingUser.email,
        providerType: PROVIDER_TYPE,
        newIdentityLinked: true,
      },
    });

    return { allowed: true, user: updatedUser || existingUser, providerType: PROVIDER_TYPE };
  }

  const newUser = await storage.users.createUser({
    email,
    firstName: firstName || displayName?.split(" ")[0] || null,
    lastName: lastName || displayName?.split(" ").slice(1).join(" ") || null,
    isActive: true,
  });

  await storage.authIdentities.create({
    userId: newUser.id,
    providerType: PROVIDER_TYPE,
    externalId,
    email,
    displayName: displayName || `${firstName} ${lastName}`.trim(),
  });

  const context = getRequestContext();
  storageLogger.info("Authentication event: new user created via SAML", {
    module: "auth",
    operation: "create",
    entity_id: newUser.id,
    description: `New user created via SAML: ${newUser.email}`,
    user_id: newUser.id,
    user_email: newUser.email,
    ip_address: context?.ipAddress,
    meta: {
      userId: newUser.id,
      email: newUser.email,
      providerType: PROVIDER_TYPE,
    },
  });

  return { allowed: true, user: newUser, providerType: PROVIDER_TYPE };
}

export function isSamlConfigured(): boolean {
  return getSamlConfig() !== null;
}

export async function setupSamlAuth(app: Express): Promise<boolean> {
  const config = getSamlConfig();

  if (!config) {
    logger.info("SAML auth not configured - missing environment variables", {
      source: "auth",
      required: ["SAML_ENTRY_POINT", "SAML_ISSUER", "SAML_CALLBACK_URL", "SAML_IDP_CERT"],
    });
    return false;
  }

  logger.info("Setting up SAML authentication", {
    source: "auth",
    issuer: config.issuer,
    entryPoint: config.entryPoint,
  });

  const strategy = new SamlStrategy(
    {
      entryPoint: config.entryPoint,
      issuer: config.issuer,
      callbackUrl: config.callbackUrl,
      idpCert: config.cert,
      privateKey: config.privateCert,
      identifierFormat: config.identifierFormat || undefined,
      wantAssertionsSigned: true,
      acceptedClockSkewMs: 5000,
    },
    async (profile: Profile | null | undefined, done: (error: any, user?: any) => void) => {
      if (!profile) {
        return done(new Error("No SAML profile received"));
      }

      try {
        const accessCheck = await checkUserAccess(profile);

        if (!accessCheck.allowed) {
          return done(new Error("Access denied. Please contact an administrator."));
        }

        const user: any = {
          claims: {
            sub: profile.nameID,
            email: profile.email,
            first_name: profile.firstName,
            last_name: profile.lastName,
          },
          dbUser: accessCheck.user,
          providerType: PROVIDER_TYPE,
          expires_at: Math.floor(Date.now() / 1000) + 8 * 60 * 60,
        };

        return done(null, user);
      } catch (error) {
        logger.error("SAML authentication error", { source: "auth", error });
        return done(error);
      }
    },
    async (profile: Profile | null | undefined, done: (error: any, user?: any) => void) => {
      done(null, { nameID: profile?.nameID });
    }
  );

  passport.use("saml", strategy);

  app.get("/api/saml/login", passport.authenticate("saml"));

  app.post(
    "/api/saml/callback",
    passport.authenticate("saml", {
      failureRedirect: "/unauthorized",
    }),
    (req, res) => {
      res.redirect("/");
    }
  );

  app.get("/api/saml/metadata", (req, res) => {
    try {
      const metadata = strategy.generateServiceProviderMetadata(
        config.privateCert || null,
        config.privateCert || null
      );
      res.type("application/xml");
      res.send(metadata);
    } catch (error) {
      logger.error("Failed to generate SAML metadata", { source: "auth", error });
      res.status(500).json({ message: "Failed to generate metadata" });
    }
  });

  app.get("/api/saml/logout", async (req, res) => {
    const user = req.user as any;

    if (user?.dbUser) {
      const context = getRequestContext();
      storageLogger.info("Authentication event: logout", {
        module: "auth",
        operation: "logout",
        entity_id: user.dbUser.id,
        description: `User logged out via SAML: ${user.dbUser.email}`,
        user_id: user.dbUser.id,
        user_email: user.dbUser.email,
        ip_address: context?.ipAddress,
        meta: {
          providerType: PROVIDER_TYPE,
        },
      });
    }

    req.logout(() => {
      res.redirect("/");
    });
  });

  logger.info("SAML authentication configured successfully", {
    source: "auth",
    endpoints: {
      login: "/api/saml/login",
      callback: "/api/saml/callback",
      metadata: "/api/saml/metadata",
      logout: "/api/saml/logout",
    },
  });

  return true;
}

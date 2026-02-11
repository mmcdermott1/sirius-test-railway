import { clerkMiddleware, getAuth, createClerkClient } from "@clerk/express";
import type { Express, RequestHandler } from "express";
import type { AuthProvider, ClerkProviderConfig, AuthenticatedUser } from "../types";
import { storage } from "../../storage";
import { storageLogger, logger } from "../../logger";
import { getRequestContext } from "../../middleware/request-context";

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
      entity_id: user.id,
      description: accountLinked
        ? `User logged in (account linked): ${userName}`
        : `User logged in: ${userName}`,
      user_id: user.id,
      user_email: user.email,
      ip_address: context?.ipAddress,
      meta: {
        userId: user.id,
        email: user.email,
        externalId,
        accountLinked,
        provider: "clerk",
      },
    });
  });
}

async function resolveClerkUser(
  clerkUserId: string,
  clerkUserData: {
    email?: string;
    firstName?: string | null;
    lastName?: string | null;
    profileImageUrl?: string | null;
  }
): Promise<{ allowed: boolean; user?: any }> {
  const { email, firstName, lastName, profileImageUrl } = clerkUserData;

  logger.info("Clerk auth attempt", {
    externalId: clerkUserId,
    email,
    firstName,
    lastName,
  });

  let identity = await storage.authIdentities.getByProviderAndExternalId("clerk", clerkUserId);

  if (identity) {
    const user = await storage.users.getUser(identity.userId);
    if (!user) {
      logger.warn("Auth identity found but user missing", { identityId: identity.id });
      return { allowed: false };
    }

    if (!user.isActive) {
      logger.info("User account is inactive", { userId: user.id });
      return { allowed: false };
    }

    await storage.authIdentities.update(identity.id, {
      email: email,
      displayName: `${firstName || ""} ${lastName || ""}`.trim() || undefined,
      profileImageUrl: profileImageUrl || undefined,
    });
    await storage.authIdentities.updateLastUsed(identity.id);

    const updatedUser = await storage.users.updateUser(user.id, {
      email: email,
      firstName: firstName || undefined,
      lastName: lastName || undefined,
      profileImageUrl: profileImageUrl || undefined,
    });

    await storage.users.updateUserLastLogin(user.id);
    logLoginEvent(updatedUser, clerkUserId, false);

    return { allowed: true, user: updatedUser };
  }

  if (!email) {
    logger.info("No email available from Clerk user", { clerkUserId });
    return { allowed: false };
  }

  const user = await storage.users.getUserByEmail(email);

  if (!user) {
    logger.info("No provisioned account found for email", { email });
    return { allowed: false };
  }

  if (!user.isActive) {
    logger.info("User account is inactive", { userId: user.id });
    return { allowed: false };
  }

  logger.info("Linking Clerk account to provisioned user", { userId: user.id });

  await storage.authIdentities.create({
    userId: user.id,
    providerType: "clerk",
    externalId: clerkUserId,
    email: email,
    displayName: `${firstName || ""} ${lastName || ""}`.trim() || undefined,
    profileImageUrl: profileImageUrl || undefined,
  });

  const linkedUser = await storage.users.updateUser(user.id, {
    email: email,
    firstName: firstName || undefined,
    lastName: lastName || undefined,
    profileImageUrl: profileImageUrl || undefined,
    accountStatus: "linked",
  });

  await storage.users.updateUserLastLogin(user.id);
  logLoginEvent(linkedUser, clerkUserId, true);

  return { allowed: true, user: linkedUser };
}

export function createProvider(config: ClerkProviderConfig): AuthProvider {
  return {
    type: "clerk",

    async setup(app: Express): Promise<void> {
      app.use(
        clerkMiddleware({
          publishableKey: config.publishableKey,
          secretKey: config.secretKey,
        })
      );

      app.use(async (req, _res, next) => {
        if (req.isAuthenticated?.() && req.user) {
          return next();
        }

        try {
          const auth = getAuth(req);

          if (!auth?.userId) {
            return next();
          }

          const client = createClerkClient({ secretKey: config.secretKey, publishableKey: config.publishableKey });
          const clerkUser = await client.users.getUser(auth.userId);

          const primaryEmail = clerkUser.emailAddresses?.find(
            (e: any) => e.id === clerkUser.primaryEmailAddressId
          )?.emailAddress;

          const result = await resolveClerkUser(auth.userId, {
            email: primaryEmail,
            firstName: clerkUser.firstName,
            lastName: clerkUser.lastName,
            profileImageUrl: clerkUser.imageUrl,
          });

          if (result.allowed && result.user) {
            const sessionUser: AuthenticatedUser = {
              claims: {
                sub: auth.userId,
                email: primaryEmail,
                first_name: clerkUser.firstName || undefined,
                last_name: clerkUser.lastName || undefined,
                profile_image_url: clerkUser.imageUrl || undefined,
              },
              providerType: "clerk",
              dbUser: result.user,
            };

            await new Promise<void>((resolve, reject) => {
              req.login(sessionUser, (err) => {
                if (err) reject(err);
                else resolve();
              });
            });
          }
        } catch (error) {
          logger.error("Clerk middleware user resolution error", { error });
        }

        return next();
      });

      logger.info("Clerk auth provider initialized");
    },

    getLoginHandler(): RequestHandler {
      return (_req, res) => {
        res.redirect("/");
      };
    },

    getCallbackHandler(): RequestHandler {
      return (_req, res) => {
        res.redirect("/");
      };
    },

    getLogoutHandler(): RequestHandler {
      return async (req, res) => {
        const user = req.user as AuthenticatedUser | undefined;
        let logData: {
          userId?: string;
          email?: string;
          firstName?: string;
          lastName?: string;
        } | null = null;

        if (user?.dbUser) {
          logData = {
            userId: user.dbUser.id,
            email: user.dbUser.email,
            firstName: user.dbUser.firstName || undefined,
            lastName: user.dbUser.lastName || undefined,
          };
        }

        req.logout(() => {
          if (logData) {
            setImmediate(() => {
              const name =
                logData!.firstName && logData!.lastName
                  ? `${logData!.firstName} ${logData!.lastName}`
                  : logData!.email;
              const context = getRequestContext();
              storageLogger.info("Authentication event: logout", {
                module: "auth",
                operation: "logout",
                entity_id: logData!.userId,
                description: `User logged out: ${name}`,
                user_id: logData!.userId,
                user_email: logData!.email,
                ip_address: context?.ipAddress,
                meta: {
                  userId: logData!.userId,
                  email: logData!.email,
                  provider: "clerk",
                },
              });
            });
          }

          res.redirect("/");
        });
      };
    },
  };
}

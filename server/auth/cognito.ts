import session from "express-session";
import passport from "passport";
import { Strategy as OAuth2Strategy } from "passport-oauth2";
import type { Express, RequestHandler, Request } from "express";
import connectPg from "connect-pg-simple";
import { storage } from "../storage";
import { storageLogger, logger } from "../logger";
import { getRequestContext } from "../middleware/request-context";

export function getSession() {
  if (!process.env.SESSION_SECRET) {
    throw new Error('SESSION_SECRET environment variable is required');
  }
  
  const sessionTtl = 7 * 24 * 60 * 60 * 1000;
  const pgStore = connectPg(session);
  const sessionStore = new pgStore({
    conString: process.env.DATABASE_URL,
    createTableIfMissing: false,
    ttl: sessionTtl,
    tableName: "sessions",
  });
  
  const isSecure = process.env.COOKIE_SECURE !== 'false' && process.env.NODE_ENV === 'production';
  
  return session({
    secret: process.env.SESSION_SECRET,
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      secure: isSecure,
      maxAge: sessionTtl,
    },
  });
}

function getCognitoConfig() {
  const userPoolId = process.env.COGNITO_USER_POOL_ID;
  const clientId = process.env.COGNITO_CLIENT_ID;
  const clientSecret = process.env.COGNITO_CLIENT_SECRET;
  const domain = process.env.COGNITO_DOMAIN;
  const callbackUrl = process.env.COGNITO_CALLBACK_URL;
  
  if (!userPoolId || !clientId || !clientSecret || !domain || !callbackUrl) {
    throw new Error(
      'Missing Cognito configuration. Required: COGNITO_USER_POOL_ID, COGNITO_CLIENT_ID, COGNITO_CLIENT_SECRET, COGNITO_DOMAIN, COGNITO_CALLBACK_URL'
    );
  }
  
  const region = userPoolId.split('_')[0];
  
  return {
    userPoolId,
    clientId,
    clientSecret,
    domain,
    callbackUrl,
    region,
    authorizationURL: `https://${domain}/oauth2/authorize`,
    tokenURL: `https://${domain}/oauth2/token`,
    userInfoURL: `https://${domain}/oauth2/userInfo`,
    logoutURL: `https://${domain}/logout`,
  };
}

async function findOrCreateUser(profile: any): Promise<{ allowed: boolean; user?: any }> {
  const email = profile.email;
  const cognitoUserId = profile.sub;
  
  console.log("Cognito Auth attempt:", {
    cognitoId: cognitoUserId,
    email: email,
  });
  
  let user = await storage.users.getUserByEmail(email);
  
  if (!user) {
    console.log("No provisioned account found for email:", email);
    return { allowed: false };
  }
  
  if (!user.isActive) {
    console.log("User account is inactive:", user.id);
    return { allowed: false };
  }
  
  if (!user.replitUserId) {
    const linkedUser = await storage.users.linkReplitAccount(user.id, cognitoUserId, {
      email: email,
      firstName: profile.given_name || profile.name?.split(' ')[0],
      lastName: profile.family_name || profile.name?.split(' ').slice(1).join(' '),
    });
    
    if (!linkedUser) {
      return { allowed: false };
    }
    
    user = linkedUser;
  }
  
  await storage.users.updateUserLastLogin(user.id);
  
  const userName = user.firstName && user.lastName
    ? `${user.firstName} ${user.lastName}`
    : user.email;
    
  setImmediate(() => {
    const context = getRequestContext();
    storageLogger.info("Authentication event: login", {
      module: "auth",
      operation: "login",
      entity_id: user!.id,
      description: `User logged in via Cognito: ${userName}`,
      user_id: user!.id,
      user_email: user!.email,
      ip_address: context?.ipAddress,
      meta: {
        userId: user!.id,
        email: user!.email,
        provider: "cognito",
      },
    });
  });
  
  return { allowed: true, user };
}

export async function setupCognitoAuth(app: Express) {
  const config = getCognitoConfig();
  
  app.set("trust proxy", 1);
  app.use(getSession());
  app.use(passport.initialize());
  app.use(passport.session());

  passport.use('cognito', new OAuth2Strategy({
    authorizationURL: config.authorizationURL,
    tokenURL: config.tokenURL,
    clientID: config.clientId,
    clientSecret: config.clientSecret,
    callbackURL: config.callbackUrl,
    scope: ['openid', 'email', 'profile'],
  }, async (accessToken: string, refreshToken: string, profile: any, done: any) => {
    try {
      const response = await fetch(config.userInfoURL, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      
      if (!response.ok) {
        return done(new Error('Failed to fetch user info'), false);
      }
      
      const userInfo = await response.json();
      const accessCheck = await findOrCreateUser(userInfo);
      
      if (!accessCheck.allowed) {
        return done(new Error("Access denied. Please contact an administrator."), false);
      }
      
      const user = {
        accessToken,
        refreshToken,
        dbUser: accessCheck.user,
        claims: userInfo,
        expires_at: Math.floor(Date.now() / 1000) + 3600,
      };
      
      done(null, user);
    } catch (error) {
      done(error, false);
    }
  }));

  passport.serializeUser((user: Express.User, cb) => cb(null, user));
  passport.deserializeUser(async (user: Express.User, cb) => {
    const sessionUser = user as any;
    if (sessionUser.claims?.sub && !sessionUser.dbUser) {
      try {
        const dbUser = await storage.users.getUserByEmail(sessionUser.claims.email);
        if (dbUser) {
          sessionUser.dbUser = dbUser;
        }
      } catch (error) {
        logger.error('Failed to rehydrate dbUser during deserialization', { error });
      }
    }
    cb(null, user);
  });

  app.get("/api/login", passport.authenticate('cognito'));

  app.get("/api/callback", passport.authenticate('cognito', {
    successReturnToOrRedirect: "/",
    failureRedirect: "/unauthorized",
  }));

  app.get("/api/logout", (req, res) => {
    const user = req.user as any;
    
    if (user?.dbUser) {
      const logData = user.dbUser;
      setImmediate(() => {
        const context = getRequestContext();
        storageLogger.info("Authentication event: logout", {
          module: "auth",
          operation: "logout",
          entity_id: logData.id,
          description: `User logged out: ${logData.email}`,
          user_id: logData.id,
          user_email: logData.email,
          ip_address: context?.ipAddress,
        });
      });
    }
    
    req.logout(() => {
      const logoutUrl = new URL(config.logoutURL);
      logoutUrl.searchParams.set('client_id', config.clientId);
      logoutUrl.searchParams.set('logout_uri', process.env.APP_URL || `${req.protocol}://${req.hostname}`);
      res.redirect(logoutUrl.href);
    });
  });
}

export const isAuthenticated: RequestHandler = async (req, res, next) => {
  const user = req.user as any;

  if (!req.isAuthenticated() || !user) {
    return res.status(401).json({ message: "Unauthorized" });
  }

  const now = Math.floor(Date.now() / 1000);
  if (user.expires_at && now > user.expires_at) {
    return res.status(401).json({ message: "Session expired" });
  }

  return next();
};

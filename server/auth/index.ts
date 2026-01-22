import type { Express, RequestHandler } from "express";
import { setupReplitAuth, isAuthenticated as replitIsAuthenticated, getSession as replitGetSession, getReplitLogoutUrl, logLogoutEvent } from "./replit";
import { setupSamlAuth, isSamlConfigured } from "./saml";
import { setupCognitoAuth, isCognitoConfigured } from "./cognito";
import type { AuthProviderType } from "@shared/schema";
import { logger } from "../logger";

export type AuthProvider = AuthProviderType;

export function getAuthProvider(): AuthProvider {
  if (isSamlConfigured()) {
    return "saml";
  }
  if (isCognitoConfigured()) {
    return "oauth";
  }
  if (process.env.REPL_ID) {
    return "replit";
  }
  return "replit";
}

export async function setupAuth(app: Express): Promise<void> {
  await setupReplitAuth(app);
  
  const providers: string[] = [];
  
  if (process.env.REPL_ID) {
    providers.push("replit");
  }
  
  const samlConfigured = await setupSamlAuth(app);
  if (samlConfigured) {
    providers.push("saml");
  }
  
  const cognitoConfigured = await setupCognitoAuth(app);
  if (cognitoConfigured) {
    providers.push("cognito");
  }
  
  if (providers.length > 1) {
    logger.info("Multiple auth providers configured", {
      source: "auth",
      providers,
    });
  }
  
  app.get("/api/auth/providers", (_req, res) => {
    res.json({
      providers: {
        replit: !!process.env.REPL_ID,
        saml: samlConfigured,
        cognito: cognitoConfigured,
      },
    });
  });
  
  app.get("/api/logout", async (req, res) => {
    const user = req.user as any;
    const providerType = user?.providerType;
    
    logger.info("Unified logout requested", {
      source: "auth",
      providerType,
      hasUser: !!user,
    });
    
    // Log the logout event for audit trail
    await logLogoutEvent(req);
    
    if (providerType === "oauth" && cognitoConfigured) {
      return res.redirect("/api/auth/cognito/logout");
    }
    
    if (providerType === "saml" && samlConfigured) {
      return res.redirect("/api/saml/logout");
    }
    
    // Replit OIDC logout
    if (providerType === "replit" && process.env.REPL_ID) {
      const replitLogoutUrl = await getReplitLogoutUrl(req);
      if (replitLogoutUrl) {
        req.logout(() => {
          res.redirect(replitLogoutUrl);
        });
        return;
      }
    }
    
    // Fallback: local session destroy
    req.logout((err) => {
      if (err) {
        logger.error("Logout error", { source: "auth", error: err.message });
      }
      req.session?.destroy((sessionErr) => {
        if (sessionErr) {
          logger.error("Session destroy error", { source: "auth", error: sessionErr.message });
        }
        res.redirect("/login");
      });
    });
  });
}

export const isAuthenticated: RequestHandler = replitIsAuthenticated;

export function getSession() {
  return replitGetSession();
}

export { getCurrentUser } from "./currentUser";

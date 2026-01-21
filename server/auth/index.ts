import type { Express, RequestHandler } from "express";
import { setupReplitAuth, isAuthenticated as replitIsAuthenticated, getSession as replitGetSession } from "./replit";
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
}

export const isAuthenticated: RequestHandler = replitIsAuthenticated;

export function getSession() {
  return replitGetSession();
}

export { getCurrentUser } from "./currentUser";

import type { Express, RequestHandler } from "express";
import { setupReplitAuth, isAuthenticated as replitIsAuthenticated, getSession as replitGetSession } from "./replit";
import { setupSamlAuth, isSamlConfigured } from "./saml";
import type { AuthProviderType } from "@shared/schema";
import { logger } from "../logger";

export type AuthProvider = AuthProviderType;

export function getAuthProvider(): AuthProvider {
  if (isSamlConfigured()) {
    return "saml";
  }
  if (process.env.REPL_ID) {
    return "replit";
  }
  return "replit";
}

export async function setupAuth(app: Express): Promise<void> {
  await setupReplitAuth(app);
  
  const samlConfigured = await setupSamlAuth(app);
  
  if (samlConfigured) {
    logger.info("Multiple auth providers configured", {
      source: "auth",
      providers: ["replit", "saml"],
    });
  }
}

export const isAuthenticated: RequestHandler = replitIsAuthenticated;

export function getSession() {
  return replitGetSession();
}

export { getCurrentUser } from "./currentUser";

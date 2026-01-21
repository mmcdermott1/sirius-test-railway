import type { Express, RequestHandler } from "express";
import { setupReplitAuth, isAuthenticated as replitIsAuthenticated, getSession as replitGetSession } from "./replit";
import type { AuthProviderType } from "@shared/schema";

export type AuthProvider = AuthProviderType;

export function getAuthProvider(): AuthProvider {
  return "replit";
}

export async function setupAuth(app: Express): Promise<void> {
  await setupReplitAuth(app);
}

export const isAuthenticated: RequestHandler = replitIsAuthenticated;

export function getSession() {
  return replitGetSession();
}

export { getCurrentUser } from "./currentUser";

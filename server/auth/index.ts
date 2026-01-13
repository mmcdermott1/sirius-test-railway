import type { Express, RequestHandler } from "express";
import { setupReplitAuth, isAuthenticated as replitIsAuthenticated, getSession as replitGetSession } from "./replit";
import { setupCognitoAuth, isAuthenticated as cognitoIsAuthenticated, getSession as cognitoGetSession } from "./cognito";

export type AuthProvider = "replit" | "cognito" | "oidc";

export function getAuthProvider(): AuthProvider {
  const provider = process.env.AUTH_PROVIDER as AuthProvider;
  if (provider && ["replit", "cognito", "oidc"].includes(provider)) {
    return provider;
  }
  if (process.env.REPL_ID) {
    return "replit";
  }
  return "replit";
}

export async function setupAuth(app: Express): Promise<void> {
  const provider = getAuthProvider();
  
  switch (provider) {
    case "replit":
      await setupReplitAuth(app);
      break;
    case "cognito":
      await setupCognitoAuth(app);
      break;
    case "oidc":
      console.warn("Generic OIDC auth provider not yet implemented. Using Replit auth as fallback.");
      await setupReplitAuth(app);
      break;
    default:
      await setupReplitAuth(app);
  }
}

export const isAuthenticated: RequestHandler = (req, res, next) => {
  const provider = getAuthProvider();
  
  switch (provider) {
    case "cognito":
      return cognitoIsAuthenticated(req, res, next);
    case "replit":
    case "oidc":
    default:
      return replitIsAuthenticated(req, res, next);
  }
};

export function getSession() {
  const provider = getAuthProvider();
  
  switch (provider) {
    case "cognito":
      return cognitoGetSession();
    case "replit":
    case "oidc":
    default:
      return replitGetSession();
  }
}

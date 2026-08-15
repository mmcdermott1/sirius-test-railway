import { getEnvironmentVariable } from "../../../config/env-registry";
export function getPublicBaseUrl(): string | undefined {
  if (getEnvironmentVariable("REPLIT_DEV_DOMAIN")) {
    return `https://${getEnvironmentVariable("REPLIT_DEV_DOMAIN")}`;
  }
  
  if (getEnvironmentVariable("REPLIT_DEPLOYMENT_DOMAIN")) {
    return `https://${getEnvironmentVariable("REPLIT_DEPLOYMENT_DOMAIN")}`;
  }
  
  if (getEnvironmentVariable("PUBLIC_URL")) {
    return getEnvironmentVariable("PUBLIC_URL");
  }
  
  return undefined;
}

export function buildStatusCallbackUrl(commId: string): string | undefined {
  const baseUrl = getPublicBaseUrl();
  
  if (!baseUrl) {
    console.warn('No public URL available for status callback - REPLIT_DEV_DOMAIN, REPLIT_DEPLOYMENT_DOMAIN, and PUBLIC_URL are all undefined');
    return undefined;
  }
  
  return `${baseUrl}/api/comm/statuscallback/${commId}`;
}

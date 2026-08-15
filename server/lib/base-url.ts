/**
 * Absolute base URL of this deployment, for links that leave the app
 * (email, SMS). In-app messages navigate with relative paths instead.
 * Centralizes the domain resolution the event notifiers previously
 * each duplicated.
 */
export function absoluteBaseUrl(): string {
  const domain =
    process.env.REPLIT_DEV_DOMAIN ||
    process.env.REPLIT_DOMAINS?.split(",")[0] ||
    "localhost:5000";
  return `https://${domain}`;
}

/** Prefix a relative path with the absolute base URL. */
export function absoluteUrl(relative: string): string {
  return `${absoluteBaseUrl()}${relative}`;
}

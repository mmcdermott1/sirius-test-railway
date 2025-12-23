export type SystemMode = "dev" | "test" | "live";

export interface SystemModeResponse {
  mode: SystemMode;
}

export interface SiteSettings {
  siteName: string;
  footer: string;
}

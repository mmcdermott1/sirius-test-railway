/**
 * Admin routes for the Freeman EDLS migration connection.
 *
 * Both a settings report and the connection test itself. Gated exactly the way
 * the Teamsters 631 client routes are: authenticated, admin, EDLS enabled, and
 * this component enabled — the page is unreachable and the endpoints refuse
 * when the component is off.
 */
import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../../components";
import {
  FREEMAN_EDLS_MIGRATE_COMPONENT_ID,
  freemanEdlsMigratePing,
  getFreemanEdlsMigrateSettingsStatus,
  redactFreemanEdlsMigrateSecrets,
} from "./client";

/**
 * An unexpected error's text is written by code we do not control end to end,
 * so it goes through the same redaction as a result before it is sent.
 */
function failureMessage(error: unknown, fallback: string): string {
  return redactFreemanEdlsMigrateSecrets(error instanceof Error ? error.message : fallback);
}

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (
  permissionKey: string,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerFreemanEdlsMigrateRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  requirePermission: PermissionMiddleware,
) {
  const edlsComponent = requireComponent("edls");
  const migrateComponent = requireComponent(FREEMAN_EDLS_MIGRATE_COMPONENT_ID);
  const gate = [requireAuth, requirePermission("admin"), edlsComponent, migrateComponent];

  app.get(
    "/api/sitespecific/freeman/edls-migrate/settings",
    ...gate,
    async (_req: Request, res: Response) => {
      try {
        res.json(getFreemanEdlsMigrateSettingsStatus());
      } catch (error) {
        res.status(500).json({
          message: failureMessage(error, "Failed to read migration settings"),
        });
      }
    },
  );

  app.post(
    "/api/sitespecific/freeman/edls-migrate/ping",
    ...gate,
    async (_req: Request, res: Response) => {
      try {
        // A failed ping is a successful report: the result carries the reason,
        // so the endpoint answers 200 and the page renders the diagnosis.
        res.json(await freemanEdlsMigratePing());
      } catch (error) {
        res.status(500).json({ message: failureMessage(error, "Failed to run the ping") });
      }
    },
  );
}

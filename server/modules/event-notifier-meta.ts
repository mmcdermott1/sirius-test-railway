import type { Express, Request, Response } from "express";
import type { IStorage } from "../storage";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

/**
 * Admin-only metadata endpoints backing the event-notifier admin UI. Currently
 * exposes the staff/admin user list the "staff-recipients" config field renders
 * a picker from (used by staff-mode notifiers such as `trust-wmb-scan`).
 */
export function registerEventNotifierMetaRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage
) {
  app.get(
    "/api/event-notifier/staff-users",
    requireAuth,
    requireAccess("admin"),
    async (_req, res) => {
      try {
        const users = await storage.users.getUsersWithAnyPermission(["staff", "admin"]);
        const formatted = users.map((user) => ({
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
          displayName:
            user.firstName && user.lastName
              ? `${user.firstName} ${user.lastName}`
              : user.email,
        }));
        res.json(formatted);
      } catch (error: any) {
        console.error("Error fetching staff users:", error);
        res
          .status(500)
          .json({ message: error.message || "Failed to fetch staff users" });
      }
    }
  );

  /**
   * Token catalog for a token-templated notifier's template editor:
   * the segment graph with the notifier's event entity kind substituted
   * for the dynamic `event` root, the schema-derived field catalog, and
   * the notifier's default templates (shown as placeholders / reset
   * targets). Gated like the rest of the notifier config surface.
   */
  app.get(
    "/api/event-notifier/token-catalog/:pluginId",
    requireAuth,
    requireAccess("admin"),
    async (req, res) => {
      try {
        const { eventNotifierRegistry } = await import(
          "../plugins/event-notifier/registry"
        );
        const plugin = eventNotifierRegistry.get(req.params.pluginId);
        if (!plugin?.tokenTemplates) {
          return res
            .status(404)
            .json({ message: "Notifier not found or not token-templated" });
        }
        const { isPluginComponentEnabledSync } = await import("../plugins/_core");
        if (!isPluginComponentEnabledSync(plugin)) {
          return res.status(404).json({ message: "Notifier component is disabled" });
        }
        const { buildSegmentSpecsForEvent, buildFieldCatalog } = await import(
          "../plugins/tokens"
        );
        // Defaults may depend on the config's other fields (e.g. the T631
        // link target varies with recipientKind); the editor passes the
        // relevant subset as ?config=<json> so placeholders match what
        // dispatch would actually fall back to. Malformed → generic.
        let configData: unknown;
        if (typeof req.query.config === "string") {
          try {
            configData = JSON.parse(req.query.config);
          } catch {
            configData = undefined;
          }
        }
        res.json({
          eventEntityKind: plugin.tokenTemplates.eventEntityKind,
          segments: buildSegmentSpecsForEvent(plugin.tokenTemplates.eventEntityKind),
          fields: buildFieldCatalog(),
          defaults: plugin.tokenTemplates.defaultTemplates(configData),
        });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to load token catalog" });
      }
    }
  );
}

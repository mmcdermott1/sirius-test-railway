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
        const { buildSegmentSpecsForEvent, buildFieldCatalog, buildTokenCatalogForEvent } = await import(
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
          // Picker entries for the Template Studio token browser (includes
          // event.* entries rooted at this notifier's entity kind).
          tokens: buildTokenCatalogForEvent(plugin.tokenTemplates.eventEntityKind),
          // Whether the studio can offer "real record" preview mode —
          // driven by the generic per-entity-kind preview registry.
          realRecordPreview: (
            await import("../plugins/tokens/preview-entities")
          ).hasTokenPreviewEntities(plugin.tokenTemplates.eventEntityKind),
        });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to load token catalog" });
      }
    }
  );

  /**
   * Live preview endpoint: renders the effective per-channel templates for a
   * token-templated notifier against a sample event entity + optional real
   * recipient contact.  Returns per-channel, per-field rendered strings along
   * with unknown/missing token metadata so the editor can surface warnings.
   *
   * POST body (JSON):
   *   `configData` — the full configData including any in-progress `templates`
   *     overrides.  Using POST (not GET query params) avoids browser/proxy
   *     request-target limits that would truncate large HTML email bodies.
   *   `contactId` — optional staff/admin contact id; when supplied the
   *     recipient-rooted tokens resolve against that contact's real data.
   *     Only contacts belonging to a staff or admin user may be supplied
   *     (prevents arbitrary PII disclosure through the preview endpoint).
   *
   * The rendered output matches what `composeFromTemplates` produces at
   * delivery time: email HTML is sanitized via `sanitizeHelpHtml`, and
   * in-app link URLs that are not safe same-app-relative paths are dropped,
   * so preview and delivered message always agree.
   */
  app.post(
    "/api/event-notifier/preview/:pluginId",
    requireAuth,
    requireAccess("admin"),
    async (req: Request, res: Response) => {
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

        const body = req.body ?? {};

        // configData carries in-progress template overrides from the editor.
        const configData: unknown = body.configData ?? undefined;

        // Optional contactId: any existing contact may be used as the
        // preview recipient. Explicit product decision: anyone allowed to
        // edit tokenized messages may see any data via preview — this
        // endpoint is already admin-gated, and the delivered message would
        // expose the same data anyway.
        let contactId: string | undefined;
        if (typeof body.contactId === "string" && body.contactId) {
          const contact = await storage.contacts.getContact(body.contactId);
          if (!contact) {
            return res.status(404).json({ message: "Preview contact not found" });
          }
          contactId = body.contactId;
        }

        // Optional eventEntityId: render against a REAL event entity
        // (Template Studio "real record" mode) instead of the sample.
        let realEventEntity: import("../plugins/tokens/types").TokenEntity | null = null;
        if (typeof body.eventEntityId === "string" && body.eventEntityId) {
          const { getEnabledTokenPreviewEntities } = await import(
            "../plugins/tokens/preview-entities"
          );
          const previewEntities = await getEnabledTokenPreviewEntities(
            plugin.tokenTemplates.eventEntityKind,
          );
          if (!previewEntities) {
            return res
              .status(400)
              .json({ message: "This notifier does not support real-record preview" });
          }
          realEventEntity = await previewEntities.load(body.eventEntityId);
          if (!realEventEntity) {
            return res.status(404).json({ message: "Preview record not found" });
          }
        }

        const { resolveTemplates, isSafeRelativePath } = await import("../plugins/event-notifier/token-templates");
        const { renderTokens, createTokenEvalContext } = await import("../plugins/tokens");

        const templates = resolveTemplates(plugin, configData);
        const eventEntityKind = plugin.tokenTemplates.eventEntityKind;

        // Build a sample event entity with the correct kind so {{event.*}}
        // chains can advance to the right entity type and produce sample
        // values (rather than "missing") for every leaf token. When a real
        // entity was loaded, use it instead — sample mode must then be OFF
        // so the evaluator reads the real row rather than examples.
        const eventEntity = realEventEntity ?? { kind: eventEntityKind, row: {} };
        const useSample = !contactId && !realEventEntity;

        const cache = new Map<string, unknown>();

        const renderField = async (
          template: string,
          escapeHtml: boolean,
        ): Promise<{ rendered: string; unknownTokens: string[]; missingValues: string[] }> => {
          const ctx = createTokenEvalContext(storage, contactId, {
            sample: useSample,
            cache,
            event: eventEntity,
          });
          const result = await renderTokens(template, ctx, {
            strictUnknown: true,
            escapeHtml,
          });
          return {
            rendered: result.output,
            unknownTokens: result.unknownTokens,
            missingValues: result.missingValues,
          };
        };

        type FieldPreview = { rendered: string; unknownTokens: string[]; missingValues: string[] };
        const channels: Record<string, Record<string, FieldPreview>> = {};

        if (templates.email) {
          const subject = await renderField(templates.email.subject, false);
          // Mirror composeFromTemplates exactly: token values are HTML-escaped
          // during rendering, then the full output is run through sanitizeHelpHtml
          // to strip disallowed tags/attributes. The preview must show the same
          // markup the recipient will receive — returning unsanitized HTML would
          // both diverge from delivery and introduce an XSS sink in the admin UI.
          const rawBodyHtml = await renderField(templates.email.bodyHtml, true);
          const { sanitizeHelpHtml } = await import("../help/sanitize");
          channels.email = {
            subject,
            bodyHtml: { ...rawBodyHtml, rendered: sanitizeHelpHtml(rawBodyHtml.rendered) },
          };
        }
        if (templates.sms) {
          channels.sms = {
            message: await renderField(templates.sms.message, false),
          };
        }
        if (templates.inapp) {
          const title = await renderField(templates.inapp.title, false);
          const bodyField = await renderField(templates.inapp.body, false);

          // Mirror composeFromTemplates: drop in-app link URLs that are not
          // safe same-app-relative paths. An unsafe rendered URL (e.g. from a
          // token that substituted an absolute URL) would be dropped at
          // delivery time, so the preview must agree rather than displaying a
          // link the recipient will never receive.
          let linkUrl: FieldPreview | undefined;
          if (templates.inapp.linkUrl) {
            const raw = await renderField(templates.inapp.linkUrl, false);
            const safeUrl = isSafeRelativePath(raw.rendered) ? raw.rendered : "";
            linkUrl = { ...raw, rendered: safeUrl };
          }
          let linkLabel: FieldPreview | undefined;
          if (templates.inapp.linkLabel && linkUrl?.rendered) {
            linkLabel = await renderField(templates.inapp.linkLabel, false);
          }

          channels.inapp = { title, body: bodyField };
          if (linkUrl !== undefined) channels.inapp.linkUrl = linkUrl;
          if (linkLabel !== undefined) channels.inapp.linkLabel = linkLabel;
        }

        res.json({
          sample: useSample,
          contactId: contactId ?? null,
          eventEntityId: realEventEntity ? String(body.eventEntityId) : null,
          channels,
        });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to render preview" });
      }
    }
  );
}

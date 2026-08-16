import type { Express, Request, Response } from "express";
import type { IStorage } from "../storage";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

/**
 * Generic Template Studio endpoints: the shared token-editor popup for
 * ANY tokenized string field (email, SMS, postal, in-app, plain text)
 * that is not backed by a bespoke host endpoint. Hosts that must mirror
 * a delivery-time composition step (event notifiers) or enforce a
 * narrower preview scope (bulk messages → participants only) keep
 * their own preview endpoints; everything else uses these.
 *
 * Admin-gated: previews may resolve tokens against any contact's real
 * data (same explicit product decision as the notifier preview — the
 * delivered message would expose the same data anyway).
 */
export function registerTokenStudioRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage,
) {
  /**
   * Token catalog for the generic studio. Optional `?event=<entityKind>`
   * roots the dynamic `event` segment at that kind (and reports whether
   * real-record preview is available for it).
   */
  app.get(
    "/api/token-studio/catalog",
    requireAuth,
    requireAccess("admin"),
    async (req, res) => {
      try {
        const {
          buildSegmentSpecs,
          buildSegmentSpecsForEvent,
          buildFieldCatalog,
          buildTokenCatalog,
          buildTokenCatalogForEvent,
        } = await import("../plugins/tokens");
        const { hasTokenPreviewEntities } = await import(
          "../plugins/tokens/preview-entities"
        );
        const eventKind =
          typeof req.query.event === "string" && req.query.event
            ? req.query.event
            : undefined;
        res.json({
          eventEntityKind: eventKind ?? null,
          segments: eventKind
            ? buildSegmentSpecsForEvent(eventKind)
            : buildSegmentSpecs(),
          fields: buildFieldCatalog(),
          tokens: eventKind ? buildTokenCatalogForEvent(eventKind) : buildTokenCatalog(),
          realRecordPreview: eventKind ? hasTokenPreviewEntities(eventKind) : false,
        });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to load token catalog" });
      }
    },
  );

  /**
   * Search real records of a token entity kind for "real record"
   * preview mode. Backed by the per-kind preview-entity registry.
   */
  app.get(
    "/api/token-studio/preview-entities/:kind",
    requireAuth,
    requireAccess("admin"),
    async (req, res) => {
      try {
        const { getEnabledTokenPreviewEntities } = await import(
          "../plugins/tokens/preview-entities"
        );
        const provider = await getEnabledTokenPreviewEntities(req.params.kind);
        if (!provider) {
          return res
            .status(404)
            .json({ message: "No real-record preview for this entity kind" });
        }
        const q = typeof req.query.q === "string" ? req.query.q : "";
        const entities = await provider.search(q);
        res.json({ entities });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to search preview records" });
      }
    },
  );

  /**
   * Render arbitrary tokenized fields. POST body (JSON):
   *   `fields` — { key: template } map to render.
   *   `escapeHtmlFields` — field keys to render with HTML escaping; their
   *     output is additionally sanitized like delivered email HTML.
   *   `contactId` — optional real recipient contact.
   *   `eventEntityKind` / `eventEntityId` — optional event root: kind
   *     alone renders a sample entity of that kind; with an id, the
   *     real record is loaded via the preview-entity registry.
   */
  app.post(
    "/api/token-studio/preview",
    requireAuth,
    requireAccess("admin"),
    async (req: Request, res: Response) => {
      try {
        const body = req.body ?? {};
        const fields: Record<string, string> =
          body.fields && typeof body.fields === "object" ? body.fields : {};
        const escapeHtmlFields: string[] = Array.isArray(body.escapeHtmlFields)
          ? body.escapeHtmlFields.filter((s: unknown) => typeof s === "string")
          : [];

        let contactId: string | undefined;
        if (typeof body.contactId === "string" && body.contactId) {
          const contact = await storage.contacts.getContact(body.contactId);
          if (!contact) {
            return res.status(404).json({ message: "Preview contact not found" });
          }
          contactId = body.contactId;
        }

        const eventEntityKind =
          typeof body.eventEntityKind === "string" && body.eventEntityKind
            ? body.eventEntityKind
            : undefined;
        let eventEntity: import("../plugins/tokens/types").TokenEntity | undefined;
        let realEvent = false;
        if (eventEntityKind) {
          if (typeof body.eventEntityId === "string" && body.eventEntityId) {
            const { getEnabledTokenPreviewEntities } = await import(
              "../plugins/tokens/preview-entities"
            );
            const provider = await getEnabledTokenPreviewEntities(eventEntityKind);
            if (!provider) {
              return res.status(400).json({
                message: "This entity kind does not support real-record preview",
              });
            }
            const loaded = await provider.load(body.eventEntityId);
            if (!loaded) {
              return res.status(404).json({ message: "Preview record not found" });
            }
            eventEntity = loaded;
            realEvent = true;
          } else {
            eventEntity = { kind: eventEntityKind, row: {} };
          }
        }

        const { renderTokens, createTokenEvalContext } = await import(
          "../plugins/tokens"
        );
        const { sanitizeHelpHtml } = await import("../help/sanitize");
        const useSample = !contactId && !realEvent;
        const cache = new Map<string, unknown>();

        type FieldPreview = {
          rendered: string;
          unknownTokens: string[];
          missingValues: string[];
        };
        const rendered: Record<string, FieldPreview> = {};
        for (const [key, template] of Object.entries(fields)) {
          if (typeof template !== "string") continue;
          const escapeHtml = escapeHtmlFields.includes(key);
          const ctx = createTokenEvalContext(storage, contactId, {
            sample: useSample,
            cache,
            event: eventEntity,
          });
          const result = await renderTokens(template, ctx, {
            strictUnknown: true,
            escapeHtml,
          });
          rendered[key] = {
            // HTML fields are sanitized exactly like delivered email HTML
            // so the admin preview is not an XSS sink and matches delivery.
            rendered: escapeHtml ? sanitizeHelpHtml(result.output) : result.output,
            unknownTokens: result.unknownTokens,
            missingValues: result.missingValues,
          };
        }

        res.json({
          sample: useSample,
          contactId: contactId ?? null,
          eventEntityId: realEvent ? String(body.eventEntityId) : null,
          fields: rendered,
        });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to render preview" });
      }
    },
  );
}

import type { Express, Request, Response } from "express";
import type { IStorage } from "../storage";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

/**
 * Template Studio endpoints: the token catalog, the real-record picker
 * and THE ONE preview route every tokenized surface renders through.
 *
 * There is no per-surface preview endpoint: a surface registers with
 * the template-surface registry (which declares only how its fields are
 * shaped at delivery time) and the client posts the surface id plus the
 * editor's in-progress values here.
 *
 * Preview is staff-gated and nothing narrower: anyone who can write a
 * tokenized string may preview it against any record (explicit product
 * decision — the studio is a general-purpose data-reading tool and the
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
   * THE preview route. POST body (JSON):
   *   `surfaceId` — registered template surface being edited.
   *   `values` — { fieldKey: template } the editor currently holds.
   *   `params` — surface-specific parameters (notifier id + channel,
   *     bulk medium, event entity kind for ad-hoc fields…).
   *   `contactId` — optional real recipient contact.
   *   `eventEntityId` — optional real event record (loaded through the
   *     preview-entity registry for the kind the surface declares);
   *     without it the event root renders sample values.
   *
   * Field media (plain / HTML / relative URL) comes from the surface's
   * declaration, never from the request, so the preview always applies
   * the shaping delivery will apply.
   */
  app.post(
    "/api/template-studio/preview",
    requireAuth,
    requireAccess("staff"),
    async (req: Request, res: Response) => {
      try {
        const body = req.body ?? {};
        const surfaceId = typeof body.surfaceId === "string" ? body.surfaceId : "";
        const { getTemplateSurface, renderTemplateSurface, TemplateSurfaceError } =
          await import("../plugins/template-surfaces");
        const surface = getTemplateSurface(surfaceId);
        if (!surface) {
          return res
            .status(404)
            .json({ message: `Unknown template surface "${surfaceId}"` });
        }

        const values: Record<string, string> =
          body.values && typeof body.values === "object" ? body.values : {};
        const params: Record<string, unknown> =
          body.params && typeof body.params === "object" ? body.params : {};

        try {
          const preview = await renderTemplateSurface({
            storage,
            surface,
            params,
            values,
            contactId:
              typeof body.contactId === "string" && body.contactId
                ? body.contactId
                : undefined,
            eventEntityId:
              typeof body.eventEntityId === "string" && body.eventEntityId
                ? body.eventEntityId
                : undefined,
          });
          res.json(preview);
        } catch (error: unknown) {
          if (error instanceof TemplateSurfaceError) {
            return res.status(error.status).json({ message: error.message });
          }
          throw error;
        }
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to render preview" });
      }
    },
  );
}

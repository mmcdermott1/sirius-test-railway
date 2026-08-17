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
/** Seeded records from the request body: { <entity kind>: <record id> }. */
function parseRecords(raw: unknown): Record<string, string> {
  if (!raw || typeof raw !== "object") return {};
  const out: Record<string, string> = {};
  for (const [kind, id] of Object.entries(raw as Record<string, unknown>)) {
    if (typeof id === "string" && id) out[kind] = id;
  }
  return out;
}

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
        const { listTokenPreviewRoots } = await import(
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
          // Every root these tokens can be rooted at, and which of them
          // can be previewed against a real record right now — the
          // studio renders one record picker per available root.
          previewRoots: await listTokenPreviewRoots(eventKind),
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
   *   `records` — optional real record per root, keyed by entity kind
   *     ({ worker: "…", dispatch_job: "…" }), each loaded through that
   *     kind's preview-entity provider. A root with no record renders
   *     sample values, so one preview can mix real and sample roots.
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
            records: parseRecords(body.records),
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

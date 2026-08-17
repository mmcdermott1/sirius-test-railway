import type { Express, Request, Response } from "express";
import type { IStorage } from "../storage";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

/**
 * Template Studio endpoints: the token catalog, the preview SUBJECTS a
 * surface offers, and THE ONE preview route every tokenized surface
 * renders through.
 *
 * There is no per-surface preview endpoint: a surface registers with
 * the template-surface registry (which declares only how its fields are
 * shaped at delivery time) and the client posts the surface id plus the
 * editor's in-progress values here.
 *
 * A preview renders against NAMED SAMPLE DATA by default. Real data is
 * available only where the surface being edited offers it — the
 * notifier's own recent events, the bulk message's own recipients — and
 * the client can only ever post back a context id the surface just
 * offered it. There is deliberately no record search and no
 * client-supplied record id: a template author must not be able to use
 * the studio to read arbitrary records.
 */
/** The preview subject from the request body: a surface context, or a sample persona. */
function parseSubject(raw: unknown): { contextId?: string; sampleSetId?: string } {
  if (!raw || typeof raw !== "object") return {};
  const body = raw as Record<string, unknown>;
  return {
    contextId: typeof body.contextId === "string" && body.contextId ? body.contextId : undefined,
    sampleSetId:
      typeof body.sampleSetId === "string" && body.sampleSetId
        ? body.sampleSetId
        : undefined,
  };
}

/** `?roots=dispatch,event` — the context roots the caller's surface seeds. */
function parseRootNames(raw: unknown): string[] {
  const values = Array.isArray(raw) ? raw : [raw];
  const out: string[] = [];
  for (const value of values) {
    if (typeof value !== "string") continue;
    for (const name of value.split(",")) {
      const trimmed = name.trim();
      if (trimmed && !out.includes(trimmed)) out.push(trimmed);
    }
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
   * Token catalog for the generic studio. Optional `?roots=a,b` names
   * the context roots the calling surface seeds (`dispatch`, `event`,
   * …); without them only the ordinary roots are offered.
   */
  app.get(
    "/api/token-studio/catalog",
    requireAuth,
    requireAccess("admin"),
    async (req, res) => {
      try {
        const {
          buildSegmentSpecsForRoots,
          buildFieldCatalog,
          buildTokenCatalogForRoots,
        } = await import("../plugins/tokens");
        const rootNames = parseRootNames(req.query.roots);
        res.json({
          rootNames,
          segments: buildSegmentSpecsForRoots(rootNames),
          fields: buildFieldCatalog(),
          tokens: buildTokenCatalogForRoots(rootNames),
        });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to load token catalog" });
      }
    },
  );

  /**
   * The token tree's ROOTS for a surface — one node per root the author
   * may start a chain at. The picker expands a node lazily through
   * `/api/token-studio/tree/type/:type`, so a deep relation graph costs
   * one small request per level instead of one giant catalog.
   */
  app.get(
    "/api/token-studio/tree/roots",
    requireAuth,
    requireAccess("admin"),
    async (req, res) => {
      try {
        const { listTokenTreeRoots } = await import("../plugins/tokens");
        res.json({ roots: listTokenTreeRoots(parseRootNames(req.query.roots)) });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to load token tree" });
      }
    },
  );

  /** One level of the token tree: what an entity type offers next. */
  app.get(
    "/api/token-studio/tree/type/:type",
    requireAuth,
    requireAccess("admin"),
    async (req, res) => {
      try {
        const { expandTokenType } = await import("../plugins/tokens");
        res.json(expandTokenType(req.params.type));
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to expand token type" });
      }
    },
  );

  /**
   * Search the tree for a surface: `?roots=a,b&q=ssn`. Matches root,
   * relation and field names at any depth and returns each hit with the
   * complete token expression and its path, so the picker never has to
   * pull the whole graph down to offer search.
   */
  app.get(
    "/api/token-studio/tree/search",
    requireAuth,
    requireAccess("admin"),
    async (req, res) => {
      try {
        const { searchTokenTree } = await import("../plugins/tokens");
        const q = typeof req.query.q === "string" ? req.query.q : "";
        res.json({ hits: searchTokenTree(parseRootNames(req.query.roots), q) });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to search tokens" });
      }
    },
  );

  /**
   * What this editor can preview against, right now: the surface's own
   * real-data contexts (already filtered to what this user may see) plus
   * the named sample personas, which are always available.
   *
   * POST, not GET, because the surface parameters that decide the answer
   * include the notifier's in-progress `configData`.
   */
  app.post(
    "/api/template-studio/preview-subjects",
    requireAuth,
    requireAccess("staff"),
    async (req: Request, res: Response) => {
      try {
        const body = req.body ?? {};
        const surfaceId = typeof body.surfaceId === "string" ? body.surfaceId : "";
        const { getTemplateSurface, TemplateSurfaceError } = await import(
          "../plugins/template-surfaces"
        );
        const surface = getTemplateSurface(surfaceId);
        if (!surface) {
          return res
            .status(404)
            .json({ message: `Unknown template surface "${surfaceId}"` });
        }
        const params: Record<string, unknown> =
          body.params && typeof body.params === "object" ? body.params : {};

        const { listSampleSetChoices } = await import("../plugins/tokens");
        const sampleSets = listSampleSetChoices();

        try {
          const contexts = surface.listPreviewContexts
            ? await surface.listPreviewContexts({ storage, params, req })
            : [];
          res.json({
            contexts,
            sampleSets,
            // Real data when the surface has any to offer, else samples.
            defaultSubject: contexts.length
              ? { contextId: contexts[0].id }
              : { sampleSetId: sampleSets[0]?.id },
          });
        } catch (error: unknown) {
          if (error instanceof TemplateSurfaceError) {
            return res.status(error.status).json({ message: error.message });
          }
          throw error;
        }
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to load preview subjects" });
      }
    },
  );

  /**
   * THE preview route. POST body (JSON):
   *   `surfaceId` — registered template surface being edited.
   *   `values` — { fieldKey: template } the editor currently holds.
   *   `params` — surface-specific parameters (notifier id + channel,
   *     bulk medium, message id, event entity kind for ad-hoc fields…).
   *   `subject` — what to render against: `{ contextId }` naming one of
   *     the contexts THIS surface offered this user, or `{ sampleSetId }`
   *     naming a sample persona. Anything else renders sample data.
   *
   * The body carries no record ids: the only real data a preview can
   * reach is what the surface itself offered and re-authorizes here.
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
        const subject = parseSubject(body.subject);

        try {
          // A context id is only ever honoured by the surface that
          // offered it, which re-authorizes it against this user.
          let seeds;
          let contactId: string | undefined;
          if (subject.contextId) {
            const resolved = surface.resolvePreviewContext
              ? await surface.resolvePreviewContext(subject.contextId, {
                  storage,
                  params,
                  req,
                })
              : null;
            if (!resolved) {
              return res
                .status(400)
                .json({ message: "That preview subject is no longer available" });
            }
            seeds = resolved.seeds;
            contactId = resolved.contactId;
          }

          const preview = await renderTemplateSurface({
            storage,
            surface,
            params,
            values,
            seeds,
            contactId,
            sampleSetId: subject.sampleSetId,
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

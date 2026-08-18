import type { Express, Request, Response } from "express";
import type { IStorage } from "../storage";
import type { TokenRootSeed } from "../plugins/tokens/types";
import type { TokenPreviewRoot } from "../plugins/tokens/preview-roots";
import type { DeliveryFieldSpec } from "@shared/delivery-fields";

type RequireAccess = (policy: any) => (req: Request, res: Response, next: () => void) => void;
type RequireAuth = (req: Request, res: Response, next: () => void) => void;

/**
 * Template Studio endpoints: the token catalog and THE ONE preview
 * route every tokenized field renders through.
 *
 * The preview request describes itself completely — the template text
 * to render, how each field is shaped at delivery time, and the context
 * to render it against. Nothing is registered anywhere and the server
 * never looks up "who is asking": adding a tokenized field somewhere
 * new takes no registration step of any kind.
 *
 * A preview renders against NAMED SAMPLE DATA by default. A caller with
 * a real record in hand may name it instead, by kind and id — and that
 * is a read of the record, so it is gated exactly like any other read
 * of it (see `server/plugins/tokens/preview-entities.ts`).
 */
/** `?roots=dispatch,event` — the named context roots the caller seeds. */
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

type ResolvedPreviewContext =
  | { seeds?: TokenRootSeed[] }
  | { status: number; message: string };

/**
 * The one form a preview context comes in, named in every refusal so a
 * caller that gets the shape wrong is told what the shape is.
 */
const PREVIEW_CONTEXT_FORM = `{ entities: [{ kind, id, rootName? }] }`;

/**
 * `entities: [ … ]` — real records, by kind and id.
 *
 * Each named record is resolved and gated INDIVIDUALLY: per kind, per
 * record, through the kind's own `previewEntity` declaration. Each
 * resolved record seeds its own root, so a preview can mix several real
 * roots with sample ones, and a kind that has declared nothing about how
 * it is gated cannot be named at all.
 */
async function resolveRecordRefs(
  raw: unknown,
  available: TokenPreviewRoot[],
  ctx: { storage: IStorage; req: Request },
): Promise<ResolvedPreviewContext> {
  if (!Array.isArray(raw)) {
    return { status: 400, message: "Preview context entities must be an array" };
  }
  if (raw.length === 0) return {};
  if (raw.length > available.length) {
    return {
      status: 400,
      message: "A preview seeds at most one record per root",
    };
  }

  const { resolveTokenPreviewEntity } = await import(
    "../plugins/tokens/preview-entities"
  );

  const seeds: TokenRootSeed[] = [];
  const seededRoots = new Set<string>();
  for (const rawEntity of raw) {
    if (!rawEntity || typeof rawEntity !== "object" || Array.isArray(rawEntity)) {
      return { status: 400, message: "Invalid preview context entity" };
    }
    const entity = rawEntity as Record<string, unknown>;
    const kind = typeof entity.kind === "string" ? entity.kind : "";
    const id = typeof entity.id === "string" ? entity.id : "";
    if (!kind || !id) {
      return { status: 400, message: "A preview context entity needs a kind and an id" };
    }

    // Which root the record seeds: the caller may name it (two roots can
    // share a kind), otherwise the first root of that kind.
    const rootName = typeof entity.rootName === "string" ? entity.rootName : "";
    const root = rootName
      ? available.find((r) => r.name === rootName)
      : available.find((r) => r.kind === kind && !seededRoots.has(r.name));
    if (!root || root.kind !== kind) {
      return {
        status: 400,
        message: `No preview root accepts a record of kind "${kind}"`,
      };
    }
    if (seededRoots.has(root.name)) {
      return {
        status: 400,
        message: `Preview root "${root.name}" is seeded more than once`,
      };
    }

    const result = await resolveTokenPreviewEntity(kind, id, {
      storage: ctx.storage,
      req: ctx.req,
    });
    if (!result.ok) return { status: result.status, message: result.message };

    seededRoots.add(root.name);
    seeds.push({ name: root.name, entity: result.entity });
  }

  // A seeded contact is also the render's recipient, exactly as on
  // delivery; `renderTemplatePreview` derives that from the seed.
  return { seeds };
}

/**
 * Turn the request's `context` into render seeds.
 *
 * ONE form, because there is only one kind of thing a preview renders
 * against: REAL records. Seeding one is a read of it, so the kind's own
 * declaration decides whether this caller may read it, and an
 * undeclared kind is refused rather than assumed safe.
 *
 * A shape this route no longer has is REFUSED, not ignored. A caller
 * sending one is describing a render it will not get, and quietly
 * rendering something else would be the lie a preview must never tell.
 */
async function resolvePreviewContext(
  raw: unknown,
  ctx: { storage: IStorage; req: Request; rootNames: string[] },
): Promise<ResolvedPreviewContext> {
  if (raw === undefined || raw === null) return {};
  if (typeof raw !== "object" || Array.isArray(raw)) {
    return { status: 400, message: "Invalid preview context" };
  }
  const context = raw as Record<string, unknown>;
  // PRESENCE, not truthiness: `{"entity": null}` is valid JSON, and a
  // key that is present but empty is still a caller describing a shape
  // this route no longer has. Own-property so an inherited key can't
  // masquerade as one the caller sent.
  const sent = (key: string): boolean =>
    Object.prototype.hasOwnProperty.call(context, key);

  // A single record used to be its own notation, identical to a
  // one-element list.
  if (sent("entity")) {
    return {
      status: 400,
      message:
        `A preview context has no single "entity" form — give ` +
        PREVIEW_CONTEXT_FORM,
    };
  }

  // Raw root VALUES used to be a second form, trusted differently
  // because they reached no record. Nothing ever sent them, so they are
  // gone — along with the guards that kept them from reaching one.
  if (sent("roots")) {
    return {
      status: 400,
      message:
        `A preview context no longer takes raw root values — name the ` +
        `records to render against: ` +
        PREVIEW_CONTEXT_FORM,
    };
  }

  // The discriminant existed only to choose between those two trust
  // levels. With one form there is nothing to discriminate.
  if (sent("source")) {
    return {
      status: 400,
      message:
        `A preview context has only one form and does not name it — ` +
        `give ` +
        PREVIEW_CONTEXT_FORM,
    };
  }

  const { listTokenPreviewRoots } = await import(
    "../plugins/tokens/preview-roots"
  );
  const available = listTokenPreviewRoots(ctx.rootNames);
  return resolveRecordRefs(context.entities, available, ctx);
}

export function registerTokenStudioRoutes(
  app: Express,
  requireAuth: RequireAuth,
  requireAccess: RequireAccess,
  storage: IStorage,
) {
  /**
   * Token catalog for the generic studio. Optional `?roots=a,b` names
   * the context roots the caller's templates address (`dispatch`,
   * `event`, …); without them only the ordinary roots are offered.
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
   * The token tree's ROOTS — one node per root the author may start a
   * chain at. The picker expands a node lazily through
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
   * Search the tree: `?roots=a,b&q=ssn`. Matches root,
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
   * THE STUDIO'S OWN CONTEXT: which roots an author may pick a real
   * record for. `?roots=dispatch,event` names the context roots the
   * caller's templates address.
   *
   * This depends on the roots alone — a kind declares how a preview
   * read of it is gated, and its component is on — never on a render.
   * So the studio fetches it once when it opens, and the picker is
   * usable before anything has been previewed at all. Whether THIS
   * author may read any PARTICULAR record is a different question,
   * decided per record when the picker searches.
   */
  app.get(
    "/api/template-studio/preview-roots",
    requireAuth,
    requireAccess("staff"),
    async (req: Request, res: Response) => {
      try {
        const { listTokenPreviewRoots } = await import(
          "../plugins/tokens/preview-roots"
        );
        const { listPickableTokenPreviewKinds } = await import(
          "../plugins/tokens/preview-entities"
        );
        const pickableKinds = await listPickableTokenPreviewKinds();
        const roots = listTokenPreviewRoots(parseRootNames(req.query.roots))
          .filter((root) => pickableKinds.has(root.kind))
          .map((root) => ({
            name: root.name,
            kind: root.kind,
            label: root.label,
          }));
        res.json({ roots });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to load preview roots" });
      }
    },
  );

  /**
   * The preview record picker: `?kind=worker&q=jane&limit=20`.
   *
   * Returns real records of ONE token entity kind that THIS caller may
   * read — the kind's own `previewEntity` declaration says how a read is
   * gated, and every candidate is checked against it before it is
   * listed, so the picker can never advertise a record its owner could
   * not open elsewhere in the app. An undeclared kind, or one whose
   * component is switched off, offers nothing.
   *
   * Staff-gated like the preview route itself; the per-record check is
   * what actually decides what comes back.
   */
  app.get(
    "/api/template-studio/preview-records",
    requireAuth,
    requireAccess("staff"),
    async (req: Request, res: Response) => {
      try {
        const kind = typeof req.query.kind === "string" ? req.query.kind : "";
        if (!kind) {
          return res.status(400).json({ message: "A record search needs a kind" });
        }
        const q = typeof req.query.q === "string" ? req.query.q : "";
        const rawLimit = Number(req.query.limit);
        const limit =
          Number.isFinite(rawLimit) && rawLimit > 0
            ? Math.min(Math.floor(rawLimit), 50)
            : 20;

        const { searchTokenPreviewRecords } = await import(
          "../plugins/tokens/preview-entities"
        );
        const result = await searchTokenPreviewRecords(kind, q, limit, {
          storage,
          req,
        });
        if (!result.ok) {
          return res.status(result.status).json({ message: result.message });
        }
        res.json({ records: result.records });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to search records" });
      }
    },
  );

  /**
   * THE preview route. POST body (JSON):
   *   `fields` — the fields being previewed and how DELIVERY shapes
   *     each one, taken from the shared delivery declarations in
   *     `shared/delivery-fields.ts` (never hand-written): a field with
   *     no declared syntax has no defined cleaning or shaping, so its
   *     preview and its delivered output could silently disagree, and
   *     it is rejected here.
   *   `values` — { fieldKey: template } — FINISHED template strings.
   *     Any caller-specific composition (a notifier's default-vs-override
   *     merge, a rich-text body flattened to plain text) has already
   *     happened on the caller's side.
   *   `rootNames` — the named record roots those templates address
   *     (`dispatch`, `event`); ordinary roots are always available.
   *   `sampleSetId` — which named sample persona unseeded roots render as.
   *   `context` — what to render AGAINST: REAL records, at most one
   *     per root — `{ entities: [{ kind, id, rootName? }, …] }`.
   *     Reading one here is a read of it, so the kind's own
   *     `previewEntity` declaration gates each one before it is
   *     seeded, a kind that has not declared how it is gated cannot be
   *     used at all, and roots left unnamed keep sample data.
   *   Omit `context` to preview against sample personas.
   */
  app.post(
    "/api/template-studio/preview",
    requireAuth,
    requireAccess("staff"),
    async (req: Request, res: Response) => {
      try {
        const body = req.body ?? {};

        // Field declarations, validated exactly as the author-time
        // check validates the shared tables they come from.
        const { validateDeliveryFieldSpecs } = await import(
          "@shared/delivery-fields"
        );
        const problems = validateDeliveryFieldSpecs(body.fields);
        if (problems.length > 0) {
          return res
            .status(400)
            .json({ message: `Invalid preview fields: ${problems.join("; ")}` });
        }
        const fields = body.fields as DeliveryFieldSpec[];

        const templates: Record<string, string> = {};
        const rawValues =
          body.values && typeof body.values === "object" ? body.values : {};
        for (const [key, value] of Object.entries(rawValues)) {
          if (typeof value === "string") templates[key] = value;
        }

        const rootNames = parseRootNames(body.rootNames);
        const sampleSetId =
          typeof body.sampleSetId === "string" && body.sampleSetId
            ? body.sampleSetId
            : undefined;

        const resolved = await resolvePreviewContext(body.context, {
          storage,
          req,
          rootNames,
        });
        if ("status" in resolved) {
          return res.status(resolved.status).json({ message: resolved.message });
        }

        const { renderTemplatePreview } = await import("./template-preview");
        const { listSampleSetChoices } = await import("../plugins/tokens");
        const preview = await renderTemplatePreview({
          storage,
          fields,
          templates,
          rootNames,
          seeds: resolved.seeds,
          sampleSetId,
        });
        // The persona choices ship with the render so the studio's
        // "preview with" picker needs no separate request.
        res.json({ ...preview, sampleSets: listSampleSetChoices() });
      } catch (error: any) {
        res
          .status(500)
          .json({ message: error.message || "Failed to render preview" });
      }
    },
  );
}

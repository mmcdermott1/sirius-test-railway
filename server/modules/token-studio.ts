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
 * of it (see `server/plugins/tokens/preview-entities.ts`). A caller may
 * also pass raw root VALUES it already has on screen; those render as
 * literal text and never reach a record (see `sanitizeRawRootValues`).
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
 * The two forms a preview context comes in, named in every refusal so a
 * caller that gets the shape wrong is told what the shapes are.
 */
const PREVIEW_CONTEXT_FORMS =
  `{ source: "values", roots: { <rootName>: { …values } } } or ` +
  `{ source: "records", entities: [{ kind, id, rootName? }] }`;

/**
 * An identifier field — `id`, `grievance_id`, `workerId`.
 *
 * Deliberately narrow: an identifier is a key that IS an id or ENDS in a
 * `_id`/`Id` suffix, so ordinary words that happen to end in the two
 * letters (`paid`, `valid`, `void`) stay perfectly good field names.
 */
function isIdentifierKey(key: string): boolean {
  // `id` / `ID`, and any `_id` suffix, in any casing…
  if (/^id$/i.test(key) || /_id$/i.test(key)) return true;
  // …plus the camelCase suffix, where the capital is what separates
  // `workerId` from `paid`.
  return /[a-z0-9](Id|ID)$/.test(key);
}

/**
 * Vet one raw root object.
 *
 * A raw root is LITERAL TEXT the author is already looking at, and this
 * is what keeps it literal. It matters because a raw context is accepted
 * on the route's plain staff gate, with no per-record check — which is
 * only defensible while the values cannot reach a record.
 *
 * Two rules, and both exist to close the same hole. Token plugins
 * traverse to related records by reading a FOREIGN KEY off the row they
 * are standing on (`grievance_status_history` → `grievance` reads
 * `grievanceId`), and the render treats a seeded contact's `id` as the
 * recipient, from which the recipient-rooted roots load for real. So a
 * caller that could put ids in a raw row could name any record in the
 * database and read it back through a relation, which is exactly the
 * check the entity form exists to perform.
 *
 *  1. Values must be scalars. A nested object or array is a smuggled
 *     record shape, never something an author typed into a field.
 *  2. No identifier keys. With no id on the row there is nothing to
 *     traverse: relations resolve to null and the render falls back to
 *     sample data for those roots, which is the honest answer.
 *
 * Refused rather than silently stripped: a preview that quietly ignored
 * half of what it was handed would be lying about what it rendered.
 */
function sanitizeRawRootValues(
  name: string,
  value: unknown,
): { ok: true; row: Record<string, unknown> } | { ok: false; message: string } {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {
      ok: false,
      message: `Preview context root "${name}" must be an object of values`,
    };
  }
  const row: Record<string, unknown> = {};
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (isIdentifierKey(key)) {
      return {
        ok: false,
        message:
          `Preview context root "${name}" cannot carry the identifier ` +
          `"${key}" — raw context values render as literal text, so name a ` +
          `record with a context entity instead`,
      };
    }
    if (raw !== null && typeof raw === "object") {
      return {
        ok: false,
        message:
          `Preview context root "${name}" field "${key}" must be a plain ` +
          `value — a raw context carries the text of one record, not ` +
          `records it relates to`,
      };
    }
    row[key] = raw;
  }
  return { ok: true, row };
}

/**
 * `{ source: "values", roots: … }` — root values the caller already has.
 *
 * Every value is vetted by `sanitizeRawRootValues`, which is what keeps
 * this form literal and therefore keeps the route's staff gate
 * sufficient. Unknown root names are refused rather than ignored, so a
 * caller is never told "rendered" about a root that was dropped.
 */
function resolveRawRootValues(
  raw: unknown,
  available: TokenPreviewRoot[],
): ResolvedPreviewContext {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return { status: 400, message: "Preview context roots must be an object" };
  }
  const seeds: TokenRootSeed[] = [];
  for (const [name, value] of Object.entries(raw as Record<string, unknown>)) {
    const root = available.find((r) => r.name === name);
    if (!root) {
      return { status: 400, message: `Unknown preview context root "${name}"` };
    }
    const vetted = sanitizeRawRootValues(name, value);
    if (!vetted.ok) return { status: 400, message: vetted.message };
    // No Drizzle table either: field names resolve off the supplied
    // object alone, so nothing follows a foreign key to a named row.
    seeds.push({ name, entity: { kind: root.kind, row: vetted.row } });
  }
  return { seeds };
}

/**
 * `{ source: "records", entities: [ … ] }` — real records, by kind and id.
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
 * TWO forms, and the difference between them is entirely about whose
 * data it is — which is why they cannot be collapsed into one:
 *
 *  - `source: "values"` is root values the author already has on screen.
 *    They render as literal text and reach no record, so the route's
 *    staff gate is the whole story.
 *  - `source: "records"` names REAL records. Seeding one is a read of
 *    it, so the kind's own declaration decides whether this caller may
 *    read it, and an undeclared kind is refused rather than assumed safe.
 *
 * The form is DECLARED, not inferred from which keys happen to be
 * present: a context that doesn't say what it is, or that carries the
 * other form's payload, is refused. Guessing here would mean guessing
 * which trust level to apply.
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
  // one-element list. Refused rather than quietly accepted, so a stale
  // caller is told what to send instead of rendering differently.
  if (sent("entity")) {
    return {
      status: 400,
      message:
        `A preview context has no single "entity" form — give ` +
        PREVIEW_CONTEXT_FORMS,
    };
  }

  const source = context.source;
  if (source !== "values" && source !== "records") {
    return {
      status: 400,
      message: `A preview context must name its form: ${PREVIEW_CONTEXT_FORMS}`,
    };
  }

  const { listTokenPreviewRoots } = await import(
    "../plugins/tokens/preview-roots"
  );
  const available = listTokenPreviewRoots(ctx.rootNames);

  if (source === "values") {
    if (sent("entities")) {
      return {
        status: 400,
        message: `A "values" preview context cannot carry entities`,
      };
    }
    return resolveRawRootValues(context.roots, available);
  }

  if (sent("roots")) {
    return {
      status: 400,
      message: `A "records" preview context cannot carry root values`,
    };
  }
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
   *     no declared media has no defined shaping, so its preview and
   *     its delivered output could silently disagree, and it is
   *     rejected here.
   *   `values` — { fieldKey: template } — FINISHED template strings.
   *     Any caller-specific composition (a notifier's default-vs-override
   *     merge, a rich-text body flattened to plain text) has already
   *     happened on the caller's side.
   *   `rootNames` — the named record roots those templates address
   *     (`dispatch`, `event`); ordinary roots are always available.
   *   `sampleSetId` — which named sample persona unseeded roots render as.
   *   `context` — what to render AGAINST. It NAMES which of the two
   *     forms it is, because the two carry different trust:
   *     `{ source: "values", roots: { <rootName>: { …values } } }` — raw
   *       JSON the author is already looking at. Staff-gated like the
   *       rest of the route: it is the caller's own content coming back,
   *       and `sanitizeRawRootValues` keeps it from reaching a record.
   *     `{ source: "records", entities: [{ kind, id, rootName? }, …] }` —
   *       REAL records, at most one per root. Reading one here is a read
   *       of it, so the kind's own `previewEntity` declaration gates
   *       each one before it is seeded, a kind that has not declared how
   *       it is gated cannot be used at all, and roots left unnamed keep
   *       sample data.
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

import type { IStorage } from "../../storage";
import type { TokenEntity } from "../tokens/types";
import { TemplateSurfaceError, type TemplateSurface } from "./types";

export interface TemplateFieldPreview {
  rendered: string;
  unknownTokens: string[];
  missingValues: string[];
  /** Tokens that rendered nothing — a hole, not a blank value. */
  emptyValues: string[];
}

/** One root of the render, and whether it resolved real or sample data. */
export interface TemplateSurfacePreviewRoot {
  kind: string;
  label: string;
  /** The record this root was previewed against, when one was picked. */
  recordId: string | null;
  /**
   * True when this root rendered real data — a picked record, or (for
   * recipient-rooted roots) the recipient contact.
   */
  real: boolean;
}

export interface TemplateSurfacePreview {
  surfaceId: string;
  /** True when NO root had a real record — the whole render is samples. */
  sample: boolean;
  /**
   * Per-root sample-vs-real, so the studio can say which parts of the
   * preview are real instead of claiming all-or-nothing.
   */
  roots: TemplateSurfacePreviewRoot[];
  contactId: string | null;
  /** Rendered output per field key (declaration order). */
  fields: Record<string, TemplateFieldPreview>;
  /**
   * False when delivery would send nothing at all with these values —
   * a field the channel requires (an in-app title, an email subject)
   * came out blank.
   */
  deliverable: boolean;
}

export interface RenderSurfaceRequest {
  storage: IStorage;
  surface: TemplateSurface;
  /** Surface-specific parameters from the request body. */
  params: Record<string, unknown>;
  /** The editor's in-progress values. */
  values: Record<string, string>;
  /** Optional real recipient contact. */
  contactId?: string;
  /**
   * Real records seeding this render's roots, keyed by entity kind
   * (`{ worker: "…", dispatch_job: "…" }`). A root with no record here
   * renders sample values. Picking a contact also makes that contact
   * the render's recipient.
   */
  records?: Record<string, string>;
  /**
   * Roots an internal caller already holds as entities (the delivery
   * -parity check renders against the very entity delivery composes
   * with). The preview route never sets this — records that arrive with
   * a request come in as `records` and load through their provider.
   */
  seededRoots?: TokenEntity[];
}

/**
 * Render one surface's fields: resolve the surface's templates, build
 * the eval context from the request's seeds (recipient contact and/or
 * event entity), render every field and apply the declared media rules.
 *
 * This is the ONE place delivery shaping happens, so every surface
 * inherits it: HTML is escaped-then-sanitized exactly like a delivered
 * email body, a relative-URL field that renders something unsafe is
 * blanked exactly as delivery would drop it, and a field declared
 * `blankWithout` disappears when the field it depends on is blank.
 *
 * Throws {@link TemplateSurfaceError} for request-level problems (bad
 * surface parameters, unknown record) so the route can map them to a
 * status code.
 */
export async function renderTemplateSurface({
  storage,
  surface,
  params,
  values,
  contactId,
  records,
  seededRoots,
}: RenderSurfaceRequest): Promise<TemplateSurfacePreview> {
  const resolution = await surface.resolve({ storage, params, values });

  const declared = new Map(surface.fields.map((f) => [f.key, f]));
  for (const key of Object.keys(resolution.templates)) {
    if (!declared.has(key)) {
      // A surface resolving an undeclared field has no media, so its
      // preview shaping is unknown — that is exactly the disagreement
      // this registry exists to prevent.
      throw new Error(
        `Template surface "${surface.id}" resolved undeclared field '${key}'`,
      );
    }
  }

  // ── Seeds: one real record per root, all of them optional ─────────────────
  const eventEntityKind = resolution.eventEntityKind;
  const { getEnabledTokenPreviewEntities, listTokenPreviewRoots } = await import(
    "../tokens/preview-entities"
  );
  const availableRoots = await listTokenPreviewRoots(eventEntityKind);

  const seeded: TokenEntity[] = [...(seededRoots ?? [])];
  const seededIds: Record<string, string> = {};
  for (const [kind, recordId] of Object.entries(records ?? {})) {
    if (!recordId) continue;
    if (!availableRoots.some((r) => r.kind === kind)) {
      throw new TemplateSurfaceError(
        400,
        `This surface does not render against a ${kind} record`,
      );
    }
    // The component gate lives in the provider lookup, and applies to
    // loading exactly as it does to searching: a disabled component's
    // tables may not exist at all.
    const provider = await getEnabledTokenPreviewEntities(kind);
    if (!provider) {
      throw new TemplateSurfaceError(
        400,
        "This entity kind does not support real-record preview",
      );
    }
    const loaded = await provider.load(recordId);
    if (!loaded) {
      throw new TemplateSurfaceError(404, "Preview record not found");
    }
    seeded.push(loaded);
    seededIds[kind] = recordId;
  }

  // Picking a contact picks the render's recipient: the recipient-rooted
  // roots (worker, employer) derive from it unless separately seeded,
  // exactly as they do on delivery.
  const recipientContactId = contactId ?? seededIds.contact;
  if (contactId) {
    const contact = await storage.contacts.getContact(contactId);
    if (!contact) {
      throw new TemplateSurfaceError(404, "Preview contact not found");
    }
  }

  const previewRoots: TemplateSurfacePreviewRoot[] = availableRoots.map((root) => ({
    kind: root.kind,
    label: root.label,
    recordId: seededIds[root.kind] ?? null,
    real:
      seeded.some((entity) => entity.kind === root.kind) ||
      (root.recipientRooted && Boolean(recipientContactId)),
  }));
  const useSample = !previewRoots.some((r) => r.real);

  // ── Render ────────────────────────────────────────────────────────────────
  const { renderTokens, createTokenEvalContext } = await import("../tokens");
  const { applyFieldEligibility, shapeRenderedValue } = await import("./shape");

  const cache = new Map<string, unknown>();
  const fields: Record<string, TemplateFieldPreview> = {};

  for (const spec of surface.fields) {
    const template = resolution.templates[spec.key];
    if (typeof template !== "string") continue;

    if (spec.media === "literal") {
      // Delivery sends this field verbatim (its editor offers no token
      // insertion), so previewing a substitution would be a lie.
      fields[spec.key] = {
        rendered: template,
        unknownTokens: [],
        missingValues: [],
        emptyValues: [],
      };
      continue;
    }

    // Sample fallback is always on in a preview: it applies per root, so
    // a root with a picked record still resolves against real data.
    const ctx = createTokenEvalContext(storage, recipientContactId, {
      sample: true,
      cache,
      roots: seeded,
      eventKind: eventEntityKind,
    });
    const result = await renderTokens(template, ctx, {
      strictUnknown: true,
      escapeHtml: spec.media === "html",
    });

    // Shape it the way delivery shapes it — same function delivery
    // calls, driven by the media the surface declared.
    fields[spec.key] = {
      rendered: shapeRenderedValue(spec, result.output),
      unknownTokens: result.unknownTokens,
      missingValues: result.missingValues,
      emptyValues: result.emptyValues,
    };
  }

  // Cross-field delivery rules: a companion field disappears with the
  // field it depends on, and a blank required field means no message.
  const rendered: Record<string, string> = {};
  for (const [key, field] of Object.entries(fields)) rendered[key] = field.rendered;
  // Only the fields this render covers count: a surface declares every
  // channel's fields, but one preview renders one channel, and another
  // channel's required field is not missing — it is not in play.
  const inPlay = surface.fields.filter(
    (spec) => typeof resolution.templates[spec.key] === "string",
  );
  const eligibility = applyFieldEligibility(inPlay, rendered);
  for (const key of Object.keys(fields)) {
    if (!(key in eligibility.values)) delete fields[key];
  }

  return {
    surfaceId: surface.id,
    sample: useSample,
    roots: previewRoots,
    contactId: recipientContactId ?? null,
    fields,
    deliverable: eligibility.deliverable,
  };
}

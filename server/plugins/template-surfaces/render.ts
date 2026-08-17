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

export interface TemplateSurfacePreview {
  surfaceId: string;
  /** True when rendered purely from sample/example data. */
  sample: boolean;
  contactId: string | null;
  eventEntityId: string | null;
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
  /** Optional real event record (needs the surface to declare a kind). */
  eventEntityId?: string;
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
  eventEntityId,
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

  // ── Seeds: recipient contact and/or event entity ──────────────────────────
  if (contactId) {
    const contact = await storage.contacts.getContact(contactId);
    if (!contact) {
      throw new TemplateSurfaceError(404, "Preview contact not found");
    }
  }

  const eventEntityKind = resolution.eventEntityKind;
  let eventEntity: TokenEntity | undefined;
  let realEvent = false;
  if (eventEntityId) {
    if (!eventEntityKind) {
      throw new TemplateSurfaceError(
        400,
        "This surface does not render against an event record",
      );
    }
    const { getEnabledTokenPreviewEntities } = await import(
      "../tokens/preview-entities"
    );
    const provider = await getEnabledTokenPreviewEntities(eventEntityKind);
    if (!provider) {
      throw new TemplateSurfaceError(
        400,
        "This entity kind does not support real-record preview",
      );
    }
    const loaded = await provider.load(eventEntityId);
    if (!loaded) {
      throw new TemplateSurfaceError(404, "Preview record not found");
    }
    eventEntity = loaded;
    realEvent = true;
  } else if (eventEntityKind) {
    // A sample entity of the right kind so `{{event.*}}` chains can
    // advance to the correct entity type and produce sample values.
    eventEntity = { kind: eventEntityKind, row: {} };
  }

  const useSample = !contactId && !realEvent;

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
      fields[spec.key] = { rendered: template, unknownTokens: [], missingValues: [] };
      continue;
    }

    const ctx = createTokenEvalContext(storage, contactId, {
      sample: useSample,
      cache,
      event: eventEntity,
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
    contactId: contactId ?? null,
    eventEntityId: realEvent ? (eventEntityId ?? null) : null,
    fields,
    deliverable: eligibility.deliverable,
  };
}

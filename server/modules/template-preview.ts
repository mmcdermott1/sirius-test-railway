import type { IStorage } from "../storage";
import type { TokenRootSeed } from "../plugins/tokens/types";
import type { DeliveryFieldSpec } from "@shared/delivery-fields";

/**
 * Rendering a tokenized template the way delivery would.
 *
 * A caller describes what it wants rendered — the template strings, and
 * how each field is shaped when it is actually sent — and this renders
 * them against whatever context it was given. There is no registration
 * step and no notion of "which editor is asking": the request says
 * everything, and the shaping runs through the same functions delivery
 * runs through (`server/delivery/shape.ts`), so the two cannot drift.
 */

export interface TemplateFieldPreview {
  rendered: string;
  unknownTokens: string[];
  missingValues: string[];
  /** Tokens that rendered nothing — a hole, not a blank value. */
  emptyValues: string[];
}

/** One root of the render, and whether it resolved real or sample data. */
export interface TemplatePreviewRoot {
  /** Root NAME — the segment a chain starts with (`dispatch`, `worker`). */
  name: string;
  kind: string;
  label: string;
  /** The record this root was previewed against, when one was seeded. */
  recordId: string | null;
  /**
   * True when an author may pick a real record for this root: its kind
   * declares how reading one is gated AND that kind's component is on.
   * Whether this particular author may read any given record is decided
   * per record, when the picker searches.
   */
  pickable: boolean;
  /**
   * True when this root rendered real data — a seeded record, or (for
   * recipient-rooted roots) the recipient contact.
   */
  real: boolean;
}

export interface TemplatePreview {
  /**
   * True when NO root had a real record — every RECORD in the render is a
   * sample. It does not mean nothing in the render is real: the system
   * values (this deployment's origin, today's date) have no record behind
   * them and always resolve for real, sample renders included.
   */
  sample: boolean;
  /**
   * Per-root sample-vs-real, so the studio can say which parts of the
   * preview are real instead of claiming all-or-nothing.
   */
  roots: TemplatePreviewRoot[];
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

export interface RenderTemplatePreviewRequest {
  storage: IStorage;
  /** The fields being rendered and how delivery shapes each of them. */
  fields: DeliveryFieldSpec[];
  /**
   * FINISHED template string per field key. Any caller-specific
   * composition (a notifier's default-vs-override merge, a rich-text
   * body flattened to plain text) has already happened: this renders
   * what it is given. A key with no string here is simply not rendered.
   */
  templates: Record<string, string>;
  /**
   * The named record roots these templates may address (`dispatch`,
   * `event`). Ordinary roots (contact, worker, employer) are always
   * available and need not be listed.
   */
  rootNames?: string[];
  /**
   * Recipient contact for the render. Set by the caller from a resolved
   * and gated context, or by an internal caller that already holds one.
   */
  contactId?: string;
  /**
   * Roots this render is seeded with, each under its root NAME.
   * Anything not seeded here renders sample values, so one preview can
   * mix real and sample roots.
   */
  seeds?: TokenRootSeed[];
  /**
   * Which named sample persona the sample roots render as. Unknown ids
   * fall back per kind — see `TokenSampleSet`.
   */
  sampleSetId?: string;
}

/** The id of the seeded record for one root, for the studio's report. */
function rootRecordId(seeds: TokenRootSeed[], name: string): string | null {
  const id = seeds.find((seed) => seed.name === name)?.entity.row.id;
  return typeof id === "string" ? id : null;
}

/**
 * Render a set of tokenized fields and shape each one exactly as
 * delivery shapes it.
 *
 * This is the ONE place preview shaping happens: HTML is
 * escaped-then-sanitized exactly like a delivered email body, a
 * relative-URL field that renders something unsafe is blanked exactly
 * as delivery would drop it, a `literal` field is never rendered at all
 * because delivery sends it verbatim, and a field declared
 * `blankWithout` disappears when the field it depends on is blank.
 */
export async function renderTemplatePreview({
  storage,
  fields: specs,
  templates,
  rootNames = [],
  contactId,
  seeds: seedsIn,
  sampleSetId,
}: RenderTemplatePreviewRequest): Promise<TemplatePreview> {
  // ── Seeds: whatever real records the caller resolved, all optional ────────
  const { listTokenPreviewRoots } = await import("../plugins/tokens/preview-roots");
  const availableRoots = listTokenPreviewRoots(rootNames);

  const seeds: TokenRootSeed[] = [...(seedsIn ?? [])];

  // A seeded contact is also the render's recipient: the
  // recipient-rooted roots (worker, employer) derive from it unless
  // separately seeded, exactly as they do on delivery.
  const seededContact = seeds.find(
    (seed) => seed.entity.kind === "contact",
  )?.entity;
  const recipientContactId =
    contactId ??
    (typeof seededContact?.row.id === "string" ? seededContact.row.id : undefined);

  const { listPickableTokenPreviewKinds } = await import(
    "../plugins/tokens/preview-entities"
  );
  const pickableKinds = await listPickableTokenPreviewKinds();

  const previewRoots: TemplatePreviewRoot[] = availableRoots.map((root) => ({
    name: root.name,
    kind: root.kind,
    label: root.label,
    recordId: rootRecordId(seeds, root.name),
    pickable: pickableKinds.has(root.kind),
    real:
      seeds.some((seed) => seed.name === root.name) ||
      (root.recipientRooted && Boolean(recipientContactId)),
  }));
  const useSample = !previewRoots.some((r) => r.real);

  // ── Render ────────────────────────────────────────────────────────────────
  const { renderTokens, createTokenEvalContext } = await import("../plugins/tokens");
  const { applyFieldEligibility, shapeRenderedValue } = await import(
    "../delivery/shape"
  );

  const cache = new Map<string, unknown>();
  const fields: Record<string, TemplateFieldPreview> = {};

  for (const spec of specs) {
    const template = templates[spec.key];
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
    // a root with a seeded record still resolves against real data.
    const ctx = createTokenEvalContext(storage, recipientContactId, {
      sample: true,
      sampleSetId,
      cache,
      seeds,
    });
    const result = await renderTokens(template, ctx, {
      strictUnknown: true,
      escapeHtml: spec.media === "html",
    });

    // Shape it the way delivery shapes it — same function delivery
    // calls, driven by the media the caller declared from the shared
    // delivery declarations.
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
  // Only the fields this render covers count: a caller may declare more
  // fields than it supplies templates for, and a field with no template
  // is not missing — it is not in play.
  const inPlay = specs.filter(
    (spec) => typeof templates[spec.key] === "string",
  );
  const eligibility = applyFieldEligibility(inPlay, rendered);
  for (const key of Object.keys(fields)) {
    if (!(key in eligibility.values)) delete fields[key];
  }

  return {
    sample: useSample,
    roots: previewRoots,
    contactId: recipientContactId ?? null,
    fields,
    deliverable: eligibility.deliverable,
  };
}

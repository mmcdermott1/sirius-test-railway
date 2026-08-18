/**
 * DELIVERY FIELD DECLARATIONS.
 *
 * What a tokenized field IS, as far as sending it is concerned: which
 * fields each channel carries, and exactly how each one is shaped
 * between rendering its tokens and putting it in front of a recipient.
 *
 * These are declarations about DELIVERY, so they live next to nothing
 * else: the server's delivery paths shape with them, and the editors
 * that preview a template import the very same constants, so a preview
 * can never claim a shaping delivery does not perform.
 *
 * The shaping IMPLEMENTATION that needs the server's HTML sanitizer
 * lives in `server/delivery/shape.ts`; everything here is pure and safe
 * to bundle into the client.
 */

/**
 * How a rendered field must be shaped so a PREVIEW matches DELIVERY.
 *
 *  - `text`         plain text; token values are inserted verbatim.
 *  - `html`         trusted HTML: token values are HTML-escaped during
 *                   render, then the whole output is sanitized exactly
 *                   like a delivered email body.
 *  - `relative-url` a same-app relative path; a rendered value that is
 *                   not safe (absolute URL, "javascript:", "//host") is
 *                   blanked, because delivery drops it too.
 *  - `literal`      NOT tokenized: delivery sends the stored value
 *                   verbatim, so the preview shows it verbatim too
 *                   (rendering it would show the author a substitution
 *                   the recipient never gets).
 */
export type DeliveryFieldMedia = "text" | "html" | "relative-url" | "literal";

/** The complete media vocabulary, for validating a declaration. */
export const DELIVERY_FIELD_MEDIA: readonly DeliveryFieldMedia[] = [
  "text",
  "html",
  "relative-url",
  "literal",
];

/** One tokenized field and how delivery shapes it. */
export interface DeliveryFieldSpec {
  /** Field key; unique within the set, shared with the client. */
  key: string;
  /** Delivery shaping for this field. Required — see the author check. */
  media: DeliveryFieldMedia;
  /**
   * Suppress this field entirely when the named field renders blank.
   * Mirrors delivery: an in-app link label is not shown when its URL
   * was dropped for being unsafe (or was never set).
   */
  blankWithout?: string;
  /** Delivery trims surrounding whitespace off this field. */
  trim?: boolean;
  /**
   * Delivery sends NOTHING when this field is blank after shaping (an
   * in-app notification needs a title and a body). The preview reports
   * the message as undeliverable instead of showing text nobody gets.
   */
  requiredForMessage?: boolean;
  /** What delivery substitutes when the field comes out blank. */
  fallback?: string;
}

/**
 * The tokenized fields of each bulk-message medium.
 *
 * Bulk content is sent as authored — nothing is trimmed and no field is
 * required (an empty subject becomes "(no subject)") — so those
 * differences are declared here rather than hidden in delivery code.
 */
export const BULK_CHANNEL_FIELDS: Record<string, DeliveryFieldSpec[]> = {
  email: [
    { key: "subject", media: "text", fallback: "(no subject)" },
    // Authored HTML: token values are escaped, then the body is
    // sanitized (bodies can be written through the API without passing
    // the rich-text editor).
    { key: "bodyHtml", media: "html" },
  ],
  sms: [{ key: "body", media: "text" }],
  postal: [{ key: "description", media: "text" }],
  inapp: [
    { key: "title", media: "text" },
    { key: "body", media: "text" },
    // A plain stored URL: its editor offers no token insertion and
    // delivery sends it verbatim, so preview it verbatim too.
    { key: "linkUrl", media: "literal" },
    { key: "linkLabel", media: "text" },
  ],
};

/**
 * The tokenized fields of each event-notifier channel.
 *
 * - Email subjects are trimmed and required (no subject → no email);
 *   the body is escaped-then-sanitized HTML.
 * - SMS is a single trimmed, required message.
 * - In-app needs a title and a body; its link must be a same-app
 *   relative path, and the label disappears with a dropped link.
 */
export const NOTIFIER_CHANNEL_FIELDS: Record<string, DeliveryFieldSpec[]> = {
  email: [
    { key: "subject", media: "text", trim: true, requiredForMessage: true },
    { key: "bodyHtml", media: "html" },
  ],
  sms: [{ key: "message", media: "text", trim: true, requiredForMessage: true }],
  inapp: [
    { key: "title", media: "text", trim: true, requiredForMessage: true },
    { key: "body", media: "text", trim: true, requiredForMessage: true },
    { key: "linkUrl", media: "relative-url", trim: true },
    { key: "linkLabel", media: "text", trim: true, blankWithout: "linkUrl" },
  ],
};

/** Same-app relative path: starts with "/", not scheme-relative "//". */
export function isSafeRelativePath(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\");
}

export interface ShapedFields {
  /** Surviving fields, keyed by field key. */
  values: Record<string, string>;
  /**
   * False when a field delivery treats as required came out blank — the
   * message is not sent at all, so the preview must say so rather than
   * show text nobody will receive.
   */
  deliverable: boolean;
}

/**
 * Apply the cross-field delivery rules: a companion field disappears
 * with the field it depends on (an in-app link label follows its link
 * URL), and a blank required field means no message at all.
 */
export function applyFieldEligibility(
  specs: DeliveryFieldSpec[],
  shaped: Record<string, string>,
): ShapedFields {
  const values: Record<string, string> = { ...shaped };
  for (const spec of specs) {
    if (!spec.blankWithout) continue;
    if (!(spec.key in values)) continue;
    if (!values[spec.blankWithout]) delete values[spec.key];
  }
  let deliverable = true;
  for (const spec of specs) {
    if (spec.requiredForMessage && !values[spec.key]) deliverable = false;
  }
  return { values, deliverable };
}

/**
 * Structural problems with a set of field declarations, as a list of
 * human-readable strings (empty means "fine").
 *
 * Used in two places, on purpose: the author-time check script runs it
 * over the tables above, and the preview endpoint runs it over the
 * specs a caller posts. A field with no declared media has no defined
 * shaping, which is the one thing these declarations exist to prevent —
 * so it is rejected wherever it appears.
 *
 * Takes `unknown` because one of its callers is a request body.
 */
export function validateDeliveryFieldSpecs(specs: unknown): string[] {
  const problems: string[] = [];
  if (!Array.isArray(specs) || specs.length === 0) {
    return ["declares no fields"];
  }
  const media = new Set<string>(DELIVERY_FIELD_MEDIA);
  const seen = new Set<string>();
  for (const raw of specs) {
    const field = raw as Partial<DeliveryFieldSpec> | null;
    if (!field || typeof field !== "object" || typeof field.key !== "string" || !field.key) {
      problems.push("has a field with no key");
      continue;
    }
    if (seen.has(field.key)) {
      problems.push(`declares field '${field.key}' more than once`);
    }
    seen.add(field.key);
    if (!field.media) {
      problems.push(`field '${field.key}' declares no media type`);
    } else if (!media.has(field.media)) {
      problems.push(`field '${field.key}' declares unknown media '${field.media}'`);
    }
    if (field.blankWithout !== undefined && typeof field.blankWithout !== "string") {
      problems.push(`field '${field.key}' has a non-string blankWithout`);
    }
    if (field.fallback !== undefined && typeof field.fallback !== "string") {
      problems.push(`field '${field.key}' has a non-string fallback`);
    }
  }
  for (const raw of specs) {
    const field = raw as Partial<DeliveryFieldSpec> | null;
    if (!field || typeof field !== "object") continue;
    if (typeof field.blankWithout === "string" && !seen.has(field.blankWithout)) {
      problems.push(
        `field '${field.key}' depends on '${field.blankWithout}', which is not a declared field`,
      );
    }
  }
  return problems;
}

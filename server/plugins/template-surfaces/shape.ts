import { sanitizeHelpHtml } from "../../help/sanitize";
import type { TemplateSurfaceFieldSpec } from "./types";

/** Same-app relative path: starts with "/", not scheme-relative "//". */
export function isSafeRelativePath(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\");
}

/**
 * Shape ONE rendered field the way delivery shapes it.
 *
 * This is the single implementation of "what happens to a tokenized
 * string between rendering it and sending it": whitespace trimming,
 * HTML sanitizing, same-app link enforcement and empty-value fallbacks.
 * Delivery code and the template studio's preview both call it, so a
 * change here can never make the two disagree.
 *
 * `literal` fields are never rendered at all (delivery sends the stored
 * value verbatim), so the caller passes the raw value through.
 */
export function shapeRenderedValue(
  spec: TemplateSurfaceFieldSpec,
  rendered: string,
): string {
  let value = rendered;
  if (spec.trim) value = value.trim();
  if (spec.media === "html") {
    // Token values were escaped during render; the completed body then
    // goes through the tag/attribute allowlist, because authored markup
    // can reach storage without passing the rich-text editor.
    value = sanitizeHelpHtml(value);
  } else if (spec.media === "relative-url") {
    // Trim first, then validate: delivery sends the trimmed URL, so a
    // padded but otherwise fine path must not preview as dropped.
    value = isSafeRelativePath(value) ? value : "";
  }
  if (!value && spec.fallback) value = spec.fallback;
  return value;
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
  specs: TemplateSurfaceFieldSpec[],
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

import { sanitizeHelpHtml } from "../help/sanitize";
import { isSafeRelativePath, type DeliveryFieldSpec } from "@shared/delivery-fields";

/**
 * The server side of the delivery field declarations in
 * `shared/delivery-fields.ts`: the one shaping step that needs the
 * server's HTML sanitizer.
 *
 * Re-exports the declarations themselves so delivery code has a single
 * import for "what the fields are and how to shape them".
 */
export {
  BULK_CHANNEL_FIELDS,
  NOTIFIER_CHANNEL_FIELDS,
  DELIVERY_FIELD_MEDIA,
  applyFieldEligibility,
  isSafeRelativePath,
  validateDeliveryFieldSpecs,
  type DeliveryFieldMedia,
  type DeliveryFieldSpec,
  type ShapedFields,
} from "@shared/delivery-fields";

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
  spec: DeliveryFieldSpec,
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

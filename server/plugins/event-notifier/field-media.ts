import type { TemplateSurfaceFieldSpec } from "../template-surfaces/types";

/**
 * What each notifier channel's template fields are, and exactly how
 * delivery shapes them.
 *
 * This table is the single source for both sides of the promise the
 * template studio makes: `composeFromTemplates` shapes the message it
 * sends with it, and the `event-notifier` template surface previews
 * with it. Change delivery behaviour here and the preview follows.
 *
 * - Email subjects are trimmed and required (no subject → no email);
 *   the body is escaped-then-sanitized HTML.
 * - SMS is a single trimmed, required message.
 * - In-app needs a title and a body; its link must be a same-app
 *   relative path, and the label disappears with a dropped link.
 */
export const NOTIFIER_CHANNEL_FIELDS: Record<string, TemplateSurfaceFieldSpec[]> = {
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

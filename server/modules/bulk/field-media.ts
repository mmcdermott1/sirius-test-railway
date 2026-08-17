import type { TemplateSurfaceFieldSpec } from "../../plugins/template-surfaces/types";

/**
 * The tokenized fields of each bulk-message medium and exactly how
 * delivery shapes them.
 *
 * Both sides of the template studio's promise read this table: the
 * `bulk-message` template surface previews with it, and the deliver-*
 * functions shape what they send with it. Unlike notifier templates,
 * bulk content is sent as authored — nothing is trimmed and no field is
 * required (an empty subject becomes "(no subject)") — so those
 * differences are declared here rather than hidden in delivery code.
 */
export const BULK_CHANNEL_FIELDS: Record<string, TemplateSurfaceFieldSpec[]> = {
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

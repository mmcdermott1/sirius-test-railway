import { mergeChannelFieldSpecs, registerTemplateSurface } from "../registry";
import {
  TemplateSurfaceError,
  type TemplateSurfaceResolution,
} from "../types";

import { BULK_CHANNEL_FIELDS } from "../../../modules/bulk/field-media";

/**
 * Bulk message content. No participant restriction: any staff user may
 * preview against any contact (explicit product decision — the studio
 * is a general-purpose data-reading tool).
 */
registerTemplateSurface({
  id: "bulk-message",
  name: "Bulk message content",
  description:
    "One medium (email / SMS / postal / in-app) of a bulk message's tokenized content.",
  fields: mergeChannelFieldSpecs(BULK_CHANNEL_FIELDS),
  async resolve({ params, values }): Promise<TemplateSurfaceResolution> {
    const channel = typeof params.channel === "string" ? params.channel : "";
    const specs = BULK_CHANNEL_FIELDS[channel];
    if (!specs) {
      throw new TemplateSurfaceError(400, `Unknown bulk medium "${channel}"`);
    }

    // Every field of the medium is in play, blank ones included, so the
    // preview reflects what delivery does with an empty value.
    const templates: Record<string, string> = {};
    for (const spec of specs) {
      const value = values[spec.key];
      templates[spec.key] = typeof value === "string" ? value : "";
    }

    if (channel === "inapp") {
      // The in-app body is composed in a rich-text editor but stored and
      // delivered as plain text, so preview the flattened text.
      const { htmlToPlainText } = await import("../../../../shared/html-to-text");
      const html = values.bodyHtml;
      if (typeof html === "string") templates.body = htmlToPlainText(html);
    }

    return { templates };
  },
});

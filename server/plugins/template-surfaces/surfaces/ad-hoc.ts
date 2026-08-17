import { registerTemplateSurface } from "../registry";
import type { TemplateSurfaceResolution } from "../types";

/**
 * Ad-hoc tokenized text: the general-purpose surface for a tokenized
 * string field that has no composition rules of its own. The editor's
 * values ARE the templates.
 *
 * Because media is declared server-side (never taken from the request),
 * this surface declares the standard field vocabulary the studio's
 * channel presentations use. A field with different delivery shaping
 * belongs in its own surface rather than here.
 */
registerTemplateSurface({
  id: "ad-hoc",
  name: "Ad-hoc tokenized text",
  description:
    "Standalone tokenized string fields with no delivery-time composition of their own.",
  fields: [
    { key: "text", media: "text" },
    { key: "subject", media: "text" },
    { key: "bodyHtml", media: "html" },
    { key: "message", media: "text" },
    { key: "title", media: "text" },
    { key: "body", media: "text" },
    { key: "linkUrl", media: "text" },
    { key: "linkLabel", media: "text" },
    { key: "description", media: "text" },
  ],
  resolve({ params, values }): TemplateSurfaceResolution {
    const templates: Record<string, string> = {};
    for (const [key, value] of Object.entries(values)) {
      if (typeof value === "string") templates[key] = value;
    }
    // The event root is a seed, not a shaping: an ad-hoc field may be
    // authored against whatever entity kind the host is editing.
    const eventEntityKind =
      typeof params.eventEntityKind === "string" && params.eventEntityKind
        ? params.eventEntityKind
        : undefined;
    return { templates, eventEntityKind };
  },
});

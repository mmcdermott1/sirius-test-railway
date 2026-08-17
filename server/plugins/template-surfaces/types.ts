import type { IStorage } from "../../storage";

/**
 * How a rendered field must be shaped so the PREVIEW matches DELIVERY.
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
 *
 * Media is DECLARED by the surface (server-side) and never taken from
 * the request, so a preview can't claim a shaping that delivery would
 * not perform.
 */
export type TemplateFieldMedia = "text" | "html" | "relative-url" | "literal";

/** One tokenized field a surface can render. */
export interface TemplateSurfaceFieldSpec {
  /** Field key; unique within the surface, shared with the client. */
  key: string;
  /** Delivery shaping for this field. Required — see the author check. */
  media: TemplateFieldMedia;
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

/** What a surface's field resolver receives. */
export interface TemplateSurfaceResolveContext {
  storage: IStorage;
  /** Surface-specific request parameters (plugin id, channel, config…). */
  params: Record<string, unknown>;
  /** The editor's in-progress values, keyed by field key. */
  values: Record<string, string>;
}

/** What a surface's field resolver produces. */
export interface TemplateSurfaceResolution {
  /**
   * Template string per field key. Every key MUST be a declared field
   * of the surface; unknown keys are a programming error.
   */
  templates: Record<string, string>;
  /**
   * Token entity kind rooting `{{event.*}}` for this render (the event
   * seed). Omitted by surfaces with no event root.
   */
  eventEntityKind?: string;
}

/**
 * A template surface: a place in the app where tokenized strings are
 * authored. A surface exists for exactly ONE reason — delivery parity:
 * it says which fields are being edited, how each is shaped at delivery
 * time, and how the editor's in-progress values become the templates to
 * render. It carries NO permissions, NO component requirements and NO
 * record restrictions; the single preview route is staff-gated and any
 * staff user may preview any field against any record.
 */
export interface TemplateSurface {
  /** Stable id posted by the client. One registration per id. */
  id: string;
  name: string;
  description?: string;
  /** Every field this surface can render, each with its media. */
  fields: TemplateSurfaceFieldSpec[];
  resolve(
    ctx: TemplateSurfaceResolveContext,
  ): Promise<TemplateSurfaceResolution> | TemplateSurfaceResolution;
}

/**
 * Thrown by a surface resolver to answer the request with a specific
 * status (e.g. the notifier it names does not exist).
 */
export class TemplateSurfaceError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
    this.name = "TemplateSurfaceError";
  }
}

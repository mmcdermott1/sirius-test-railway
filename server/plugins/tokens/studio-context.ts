import type { IStorage } from "../../storage";
import type { TokenEntityType, TokenPreviewRecordRef } from "./types";
import { listTokenPreviewRoots } from "./preview-roots";
import {
  listSampleSetChoicesForKind,
  type TokenSampleSetChoice,
} from "./sample-sets";
import {
  filterTokenPreviewRecords,
  offerTokenPreviewRecords,
  type TokenPreviewContext,
} from "./preview-entities";

/**
 * What the Template Studio can preview against, built when the studio
 * OPENS: every root a template's tokens hang off, and per root the
 * sample personas plus the real records that may seed it.
 *
 * The container that opens the studio decides what is on offer. A
 * surface holding particular records — a bulk message and its own
 * recipients — supplies them; anywhere else the root's kind offers the
 * records it would show first. Neither one is a record FINDER: a
 * template editor picks from what its own context already contains,
 * because "which record" is a question its container has already
 * answered, and a search box would invite an author to go looking
 * through records they merely happen to be allowed to read.
 *
 * The offer is UX, not the authorization boundary. Every record here
 * has passed its kind's own read gate for this caller, and the render
 * route runs that same gate again on whatever is finally named — so a
 * generous offer can never become a read the caller was not entitled
 * to, and a stale one can never become a refusal at render time that
 * the studio failed to predict.
 */

/** One real record offered as a seed for a root. */
export interface TokenStudioSeedRecord {
  id: string;
  label: string;
  hint?: string;
}

/** One root, with everything the author may render it as. */
export interface TokenStudioContextRoot {
  /** Root NAME — the segment a chain starts with (`dispatch`, `worker`). */
  name: string;
  kind: TokenEntityType;
  label: string;
  /** Named personas for this root's kind; never empty. */
  samples: TokenSampleSetChoice[];
  /**
   * Real records that may seed this root, already gated for this
   * caller. Empty means personas only — the kind declares no preview
   * read, its component is off, or nothing is on offer.
   */
  records: TokenStudioSeedRecord[];
}

export interface TokenStudioContext {
  roots: TokenStudioContextRoot[];
}

/** How many real records one root offers. */
export const STUDIO_CONTEXT_RECORD_LIMIT = 20;

export interface BuildTokenStudioContextOptions {
  /**
   * The COMPLETE ordered list of roots this container offers as seeds,
   * by root NAME. It is the panel the author sees, top to bottom, so
   * lead with the record the templates are really about. Nothing is
   * added implicitly — a container whose templates are about the
   * recipient asks for the ordinary roots by name
   * (`ordinaryPreviewRootNames`).
   */
  rootNames?: string[];
  /**
   * Records the container has in hand, keyed by ROOT NAME. A root named
   * here is offered these records and nothing else — the container's
   * own records are the point, not a fallback. They are gated like any
   * other offer.
   */
  recordsByRoot?: Record<string, TokenPreviewRecordRef[]>;
  limit?: number;
}

export async function buildTokenStudioContext(
  ctx: TokenPreviewContext & { storage: IStorage },
  options: BuildTokenStudioContextOptions = {},
): Promise<TokenStudioContext> {
  const limit = options.limit ?? STUDIO_CONTEXT_RECORD_LIMIT;
  const supplied = options.recordsByRoot ?? {};
  // A container that names no roots is offering nothing to preview
  // against, which is never what it meant: the list is the panel. Since
  // nothing is added implicitly any more, say so loudly here rather than
  // shipping an empty "Preview With" to the author.
  if (!options.rootNames?.length) {
    throw new Error(
      "buildTokenStudioContext needs the complete list of roots this container offers (see ordinaryPreviewRootNames for recipient-side surfaces)",
    );
  }

  const roots = await Promise.all(
    listTokenPreviewRoots(options.rootNames ?? []).map(async (root) => {
      const own = Object.prototype.hasOwnProperty.call(supplied, root.name)
        ? supplied[root.name]
        : undefined;
      const offered = own
        ? await filterTokenPreviewRecords(root.kind, own, limit, ctx)
        : await offerTokenPreviewRecords(root.kind, limit, ctx);
      return {
        name: root.name,
        kind: root.kind,
        label: root.label,
        samples: listSampleSetChoicesForKind(root.kind),
        // Only what the author picks from: `gateEntityId` is how the
        // gate found its subject, not something a client needs.
        records: offered.ok
          ? offered.records.map((r) => ({
              id: r.id,
              label: r.label,
              ...(r.hint ? { hint: r.hint } : {}),
            }))
          : [],
      };
    }),
  );

  return { roots };
}

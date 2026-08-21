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
  type TokenPreviewOfferResult,
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

/**
 * WHOSE records a root is offering.
 *
 * ONE RULE, everywhere: a root the container supplied a list for offers
 * that list and nothing else (`container`), and a root it named but
 * supplied nothing for falls back to the kind's own first records
 * (`kind`). The fallback is kept because a studio with nothing to
 * preview against helps nobody — but it is never passed off as the
 * container's own, so an author can see that the employers on offer are
 * not this message's employers.
 */
export type TokenStudioRecordSource = "container" | "kind";

/** Why a root has no real records to pick from. */
export type TokenStudioNoRecordsReason =
  /** The container supplied a list and it was empty. */
  | "container-empty"
  /** The container supplied records; this caller may read none of them. */
  | "container-unreadable"
  /** The kind put nothing forward (nothing there, or its component is off). */
  | "kind-offers-none"
  /** The kind put records forward; this caller may read none of them. */
  | "kind-unreadable"
  /** The kind cannot be previewed against at all — it declares no read. */
  | "not-previewable";

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
   * caller. Empty means personas only — and {@link noRecords} says
   * which of the several reasons for that this one is.
   */
  records: TokenStudioSeedRecord[];
  /** Whose records these are — see {@link TokenStudioRecordSource}. */
  recordSource: TokenStudioRecordSource;
  /** Why `records` is empty; absent whenever there are records. */
  noRecords?: {
    reason: TokenStudioNoRecordsReason;
    /** The container's own words for an empty list it supplied. */
    note?: string;
    /** The kind's refusal, when it cannot be previewed at all. */
    detail?: string;
  };
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
   *
   * A root left OUT of this map falls back to the kind's own first
   * records and is reported as `recordSource: "kind"`, so the studio
   * can say out loud that they are not this container's records.
   */
  recordsByRoot?: Record<string, TokenPreviewRecordRef[]>;
  /**
   * The container's own words for why the list it supplied for a root
   * is EMPTY, keyed by root name ("this message has no recipients
   * yet"). Only the container knows that reason, and it is the honest
   * thing to show where the picker would be — but it is narration, not
   * behaviour: the rule above is the same with or without it.
   */
  emptyRecordsNotes?: Record<string, string>;
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

  const notes = options.emptyRecordsNotes ?? {};

  const roots = await Promise.all(
    listTokenPreviewRoots(options.rootNames ?? []).map(
      async (root): Promise<TokenStudioContextRoot> => {
        const own = Object.prototype.hasOwnProperty.call(supplied, root.name)
          ? supplied[root.name]
          : undefined;
        const recordSource: TokenStudioRecordSource = own
          ? "container"
          : "kind";
        const offered = own
          ? await filterTokenPreviewRecords(root.kind, own, limit, ctx)
          : await offerTokenPreviewRecords(root.kind, limit, ctx);
        // Only what the author picks from: `gateEntityId` is how the
        // gate found its subject, not something a client needs.
        const records = offered.ok
          ? offered.records.map((r) => ({
              id: r.id,
              label: r.label,
              ...(r.hint ? { hint: r.hint } : {}),
            }))
          : [];
        return {
          name: root.name,
          kind: root.kind,
          label: root.label,
          samples: listSampleSetChoicesForKind(root.kind),
          records,
          recordSource,
          ...(records.length === 0
            ? {
                noRecords: describeEmptyOffer(
                  offered,
                  recordSource,
                  notes[root.name],
                ),
              }
            : {}),
        };
      },
    ),
  );

  return { roots };
}

/**
 * Why a root ended up with no records. "There is nothing here", "there
 * is something and you may not read it" and "this kind cannot be
 * previewed at all" are three different answers, and a studio that
 * showed one message for all three would be guessing on the author's
 * behalf.
 */
function describeEmptyOffer(
  offered: TokenPreviewOfferResult,
  source: TokenStudioRecordSource,
  note: string | undefined,
): NonNullable<TokenStudioContextRoot["noRecords"]> {
  if (!offered.ok) {
    return { reason: "not-previewable", detail: offered.message };
  }
  if (source === "container") {
    return offered.considered === 0
      ? { reason: "container-empty", ...(note ? { note } : {}) }
      : { reason: "container-unreadable" };
  }
  return offered.considered === 0
    ? { reason: "kind-offers-none" }
    : { reason: "kind-unreadable" };
}

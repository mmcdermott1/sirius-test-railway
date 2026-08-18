import type { IStorage } from "../../storage";
import type { BasePluginMetadata } from "../_core/types";
import type { TokenArgSpec } from "@shared/tokens";
import type { AnyPgTable } from "drizzle-orm/pg-core";

/**
 * Entity types flowing through a token chain. "root" is the implicit
 * type at the start of every chain; "value" terminates it. Every other
 * type names an entity kind produced by an entity/relation segment
 * (e.g. "contact", "worker", "bargaining_unit", "address").
 */
export type TokenEntityType = string;

/**
 * The object produced by every entity/relation segment. `row` holds the
 * full underlying record (all columns — template authors are trusted);
 * `table` is the Drizzle table it came from, when there is one, so the
 * generic `field` segment can resolve column names and follow foreign
 * keys to option display names.
 */
export interface TokenEntity {
  kind: TokenEntityType;
  row: Record<string, unknown>;
  table?: AnyPgTable;
}

export function tokenEntityOf(entity: unknown, kind: string): TokenEntity | null {
  const e = entity as TokenEntity | null;
  return e && typeof e === "object" && e.kind === kind && e.row ? e : null;
}

/**
 * One root of a render, seeded with a real record: the NAME a chain
 * starts with plus the record it stands for. Named, not kind-keyed, so
 * a render can seed two roots of the same kind.
 */
export interface TokenRootSeed {
  /** Root segment name as written in templates (`dispatch`, `contact`). */
  name: string;
  entity: TokenEntity;
}

/**
 * How a REAL record of one token entity kind may be used as the context
 * a template is previewed against.
 *
 * A preview that renders against a real record is a read of that
 * record, so it has to be gated like one: the declaration names the
 * access policy the caller must satisfy for the named id, and loads the
 * record. Both halves resolve the SAME id, so the check and the read
 * can never drift apart.
 *
 * FAIL CLOSED: a kind with no declaration cannot be used as a preview
 * context at all. Declaring one is a deliberate statement that "may
 * this user read this record?" has an answer here; without it the
 * preview endpoint refuses the kind rather than guessing.
 *
 * Declared ONCE per entity kind, on the token plugin that owns the kind.
 */
export interface TokenPreviewEntitySource {
  /**
   * Access policy evaluated against the requested record id — the same
   * check any other read of that record would make.
   */
  policy: string;
  /**
   * Component that must be enabled for this kind's data to be visible.
   * Defaults to the declaring plugin's `requiredComponent`: an optional
   * component's tables can be absent from the database entirely, so an
   * unguarded load errors instead of refusing.
   */
  requiredComponent?: string;
  /** Load the record, or null when there is no such record. */
  load(storage: IStorage, id: string): Promise<TokenEntity | null>;
}

/**
 * A named, wholly fictional persona for one token entity kind: the
 * values its fields render as when a template is previewed against
 * sample data instead of a real record.
 *
 * Declared on the plugin that owns the kind. Set ids are a SHARED
 * vocabulary across kinds: previewing with "martian" renders the
 * martian contact, the martian worker and the martian employer
 * together, so one pick yields a coherent story across every token in
 * the template. A kind that does not declare the chosen id falls back
 * to its own first set, and a field the set does not name falls back to
 * the token's own `example` / `sampleValue`.
 */
export interface TokenSampleSet {
  /** Shared across kinds — same id, same persona (e.g. "martian"). */
  id: string;
  /** Human label for the picker ("Martian"). Only the first kind's wins. */
  label: string;
  /**
   * Rendered value per field, keyed by the `field(name=…)` name
   * (snake_case or camelCase) or, for a leaf that is not a plain field,
   * by that leaf's segment name (e.g. "member_status").
   */
  values: Record<string, string>;
}

export interface TokenPluginMetadata extends BasePluginMetadata {
  /**
   * Segment name as written in templates (e.g. "field"). Not
   * necessarily unique — the same name may exist for different input
   * types — which is why `id` (unique) is a separate field.
   */
  segmentName: string;
  /**
   * Entity types this segment can be applied to; "root" starts chains.
   * "*" means any entity type except root (used by the generic field
   * segment).
   */
  inputTypes: TokenEntityType[];
  /** Entity type produced; "value" means a final string. */
  outputType: TokenEntityType;
  /** Argument schema. Defaults are applied before `resolve` runs. */
  args?: Record<string, TokenArgSpec>;
  /** Fallback rendered when the chain resolves to null/empty. */
  defaultValue?: string;
  /**
   * Example value used for sample previews (leaf segments).
   *
   * REQUIRED of every value-producing token (`outputType: "value"`)
   * unless the plugin declares `sampleValue` or a non-empty
   * `defaultValue`: in sample mode a leaf renders
   * `sampleValue(args) ?? example ?? defaultValue ?? ""`, so a token
   * with none of them renders an empty string and the preview shows an
   * invisible hole. Write a realistic, obviously-fake value ("Apr 17,
   * 2026", "https://example.com") — static metadata, never randomized.
   * Enforced by scripts/dev/check-token-sample-data.ts.
   */
  example?: string;
  /** Short label fragment used to build catalog labels. */
  shortLabel?: string;
  /**
   * When true, the resolved value is trusted HTML and is NOT escaped in
   * HTML media (it must be sanitized by the plugin itself). Everything
   * else is escaped. Explicit declaration only — never inferred.
   */
  emitsHtml?: boolean;
  /**
   * For entity-producing segments: the Drizzle table whose columns are
   * the valid `field(name=…)` names for the produced entity. Field
   * lists ship to the client for author-time validation and are always
   * derived from the live schema — never hardcoded.
   */
  entityTable?: AnyPgTable;
  /** Extra field names beyond the table's columns (derived/denorm). */
  entityFields?: string[];
  /** The produced entity's field set can't be enumerated; accept any name. */
  entityFieldsOpen?: boolean;
  /**
   * For entity-producing segments: when a chain ends at the produced
   * entity kind (no explicit leaf), implicitly append
   * `field(name=<defaultLeaf>)` so authors can write e.g.
   * `{{event.worker.contact}}` instead of
   * `{{event.worker.contact.field(name="display_name")}}`.
   * Declare on any ONE plugin that produces the kind; evaluation and
   * validation look up the first match by outputType.
   */
  defaultLeaf?: string;
  /** Hide from the generated picker catalog (still evaluatable). */
  hiddenFromCatalog?: boolean;
  /**
   * Root segments only: this root exists ONLY in renders whose surface
   * declares it by name — the records a notifier seeds
   * (`{{dispatch.…}}`, `{{sitespecific_t631_interview.…}}`) and the
   * `event` envelope. Context roots are left out of the default segment
   * graph and catalog (bulk messaging has no notifier records, so
   * `{{dispatch.…}}` is an unknown token there); a surface that knows
   * its roots uses `buildSegmentSpecsForRoots` / the tree API with the
   * root names it seeds.
   */
  contextRoot?: boolean;
  /**
   * Root segments only: the root resolves from the render's recipient
   * contact when its own kind has no seeded record (`{{worker…}}` in a
   * delivered message means "the recipient's worker"). Such a root
   * counts as real — not sample — whenever a recipient is present.
   */
  recipientRooted?: boolean;
  /**
   * Root segments only: the root resolves from the render context alone
   * (`{{system…}}` — dates, site origin), so there is no record to pick
   * for it and nothing personal behind it. A seedless root therefore
   * ALWAYS resolves for real, sample mode included: its values are the
   * same in a preview as at delivery, and showing them fake would only
   * hide the link and date mistakes a preview exists to catch. Its
   * `example`/`sampleValue` declarations still drive the picker's
   * example column.
   */
  seedless?: boolean;
  /**
   * How a real record of the kind this plugin produces may be named as
   * a preview context, and how reading it is gated (see
   * {@link TokenPreviewEntitySource}). Declare on exactly ONE plugin
   * per entity kind (the one that owns the kind — its root or its
   * entity descriptor); the projection is built at boot and refuses two
   * declarations for one kind. Absent means the kind cannot be
   * previewed against.
   */
  previewEntity?: TokenPreviewEntitySource;
  /**
   * Named sample personas for the kind this plugin produces (see
   * {@link TokenSampleSet}). Declare on the plugin that owns the kind.
   * Optional: a kind with no declared set still previews, rendering
   * each token's own `example` / `sampleValue`.
   */
  sampleSets?: TokenSampleSet[];
}

/**
 * Per-render evaluation context. One per recipient per delivery; the
 * `cache` may be shared across recipients within one run (memo keys
 * must therefore be fully qualified, e.g. include the contact id).
 */
export interface TokenEvalContext {
  storage: IStorage;
  /**
   * Recipient contact. The one seed the delivery pipeline always has:
   * recipient-rooted roots (`recipientRooted`) resolve from it when
   * their own kind is not seeded in `roots`.
   */

  contactId?: string;

  now: Date;
  /**
   * Sample fallback (preview only): a chain whose ROOT has no seed
   * renders sample values instead of hitting the DB. A seeded root
   * still resolves for real, so one render can mix real and sample
   * roots. Never set on delivery — there every root resolves for real
   * and a missing record renders the chain's default.
   */

  sample?: boolean;
  /**
   * Which named sample persona sample-mode chains render (see
   * {@link TokenSampleSet}). Unset — or a kind that does not declare
   * this id — renders that kind's first declared set, and then the
   * token's own `example`.
   */

  sampleSetId?: string;
  /**
   * Seeded root entities keyed by ROOT NAME — the segment a chain
   * starts with (`dispatch`, `contact`, `event`), not the entity kind:
   * one render can seed two roots of the same kind (a worker and a
   * steward). A chain whose root is present here resolves against that
   * real record; anything else falls back to the recipient
   * (recipient-rooted roots) or to samples.
   */

  roots: Record<string, TokenEntity>;
  /** Cross-segment memo cache. */

  cache: Map<string, unknown>;
  /**
   * Free-form context bag updated as the chain advances. `entity`
   * always holds the current object.
   */

  vars: Record<string, unknown>;
}

/** Memoize an async lookup in the context cache. */
export async function memo<T>(
  ctx: TokenEvalContext,
  key: string,
  fn: () => Promise<T>,
): Promise<T> {
  if (ctx.cache.has(key)) return ctx.cache.get(key) as T;
  const v = await fn();
  ctx.cache.set(key, v);
  return v;
}

export interface TokenPlugin {
  metadata: TokenPluginMetadata;
  /**
   * Resolve this segment. `entity` is the object produced by the
   * previous segment (null at chain start). `args` has defaults already
   * applied. Return the next entity object, or the final value (string
   * / number / null) for "value" segments. Null/undefined/"" values
   * render the chain's default.
   */
  resolve(
    entity: unknown,
    args: Record<string, string>,
    ctx: TokenEvalContext,
  ): Promise<unknown>;
  /**
   * Sample-mode value for leaf segments whose example depends on args
   * (e.g. the generic field segment, or a date with a custom format).
   * Falls back to metadata.example. Must never return an empty string
   * for the segment's default arguments — see `example`.
   */
  sampleValue?(args: Record<string, string>): string;
}

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

/** One pickable real record for a Template Studio "real record" preview. */
export interface TokenPreviewEntityRef {
  id: string;
  /** Human label for the picker (e.g. "Jane Doe — Crane Operator (offered)"). */
  label: string;
}

/**
 * How to find and load real records of one token entity kind so a
 * template editor can preview against real data instead of samples.
 * Anyone with access to the template-editing surface may preview any
 * record of the kind (explicit product decision — the delivered
 * message would expose the same data anyway).
 *
 * Declared ONCE per entity kind, on the token plugin that owns the kind
 * (`previewEntities` in its metadata) — never per notifier or per
 * surface. Every editor rooted at the kind inherits it.
 */
export interface TokenPreviewEntityProvider {
  /**
   * Component that must be enabled for this kind's data to be visible.
   * Defaults to the declaring plugin's `requiredComponent`. Enforced by
   * every preview endpoint (search AND load): an optional component's
   * tables can be absent from the database entirely, so an unguarded
   * search errors instead of returning nothing.
   */
  requiredComponent?: string;
  /** Search entities by free text; empty query returns recent/any. */
  search(query: string): Promise<TokenPreviewEntityRef[]>;
  /** Load one entity by id for rendering; null when it no longer exists. */
  load(id: string): Promise<TokenEntity | null>;
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
   * The produced entity type is not statically known: after `resolve`,
   * the chain's current type advances to the RESOLVED entity's `kind`
   * instead of `outputType`. Used by the generic `event` root, whose
   * entity kind is declared per notifier. Dynamic-output segments are
   * excluded from the static bulk-messaging segment graph (their type
   * can't be validated without an event context); surfaces that know
   * the concrete kind use `buildSegmentSpecsForEvent`.
   */
  dynamicOutput?: boolean;
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
   * for it. A seedless root follows the render: it resolves for real as
   * soon as anything else in the render is real, and only falls back to
   * samples when the whole render is samples.
   */
  seedless?: boolean;
  /**
   * How a template editor finds and loads real records of the kind this
   * plugin produces, for "preview against a real record". Declare on
   * exactly ONE plugin per entity kind (the one that owns the kind —
   * its root or its entity descriptor); the preview registry is built
   * from these at boot and refuses two providers for one kind.
   */
  previewEntities?: TokenPreviewEntityProvider;
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
   * Seeded root entities keyed by entity kind. A chain rooted at a kind
   * present here resolves against that real record; anything else falls
   * back to the recipient (recipient-rooted roots) or to samples.
   */

  roots: Record<TokenEntityType, TokenEntity>;
  /**
   * Entity kind the dynamic `{{event…}}` root stands for. Its record,
   * when there is one, is the seeded root named for this kind.
   */

  eventKind?: TokenEntityType;
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

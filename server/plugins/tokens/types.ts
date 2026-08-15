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
  /** Example value used for sample previews (leaf segments). */
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
}

/**
 * Per-render evaluation context. One per recipient per delivery; the
 * `cache` may be shared across recipients within one run (memo keys
 * must therefore be fully qualified, e.g. include the contact id).
 */
export interface TokenEvalContext {
  storage: IStorage;
  /** Recipient contact — undefined in sample mode. */

  contactId?: string;

  now: Date;
  /** Sample mode: leaves render their example instead of hitting the DB. */

  sample?: boolean;
  /**
   * The event entity for `{{event...}}` chains (token-templated event
   * notifiers). Absent outside notifier rendering, in which case the
   * `event` root resolves as missing.
   */

  event?: TokenEntity;
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
   * (e.g. the generic field segment). Falls back to metadata.example.
   */
  sampleValue?(args: Record<string, string>): string;
}

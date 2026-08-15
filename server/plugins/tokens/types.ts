import type { IStorage } from "../../storage";
import type { BasePluginMetadata } from "../_core/types";
import type { TokenArgSpec } from "@shared/tokens";

/**
 * Entity types flowing through a token chain. "root" is the implicit
 * type at the start of every chain; "value" terminates it. Kind-specific
 * plugins may introduce further types (e.g. "address").
 */
export type TokenEntityType =
  | "root"
  | "contact"
  | "worker"
  | "employer"
  | "system"
  | "address"
  | "value";

export interface TokenPluginMetadata extends BasePluginMetadata {
  /**
   * Segment name as written in templates (e.g. "firstName"). Not
   * necessarily unique — the same name may exist for different input
   * types — which is why `id` (unique) is a separate field.
   */
  segmentName: string;
  /** Entity types this segment can be applied to; "root" starts chains. */
  inputTypes: TokenEntityType[];
  /** Entity type produced; "value" means a final string. */
  outputType: TokenEntityType;
  /** Argument schema. Defaults are applied before `resolve` runs. */
  args?: Record<string, TokenArgSpec>;
  /** Fallback rendered when the chain resolves to null/empty. */
  defaultValue?: string;
  /** Example value used for sample previews (leaf segments). */
  example?: string;
  /** Short label fragment used to build catalog labels (leaf segments). */
  shortLabel?: string;
  /**
   * When true, the resolved value is trusted HTML and is NOT escaped in
   * HTML media (it must be sanitized by the plugin itself). Everything
   * else is escaped. Explicit declaration only — never inferred.
   */
  emitsHtml?: boolean;
  /**
   * Optional audience gate. When set and the evaluation context carries
   * an audience not in this list, the segment resolves as missing (the
   * chain renders its default) instead of leaking data to the wrong
   * audience.
   */
  audiences?: string[];
  /**
   * Extra catalog entries for leaves whose required args make a single
   * generic entry useless (e.g. field(name="street")).
   */
  catalogVariants?: Array<{
    args: Record<string, string>;
    label: string;
    description?: string;
    example?: string;
  }>;
  /** Hide from the generated picker catalog (still evaluatable). */
  hiddenFromCatalog?: boolean;
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
  /** Audience the rendered output is destined for (see `audiences`). */
  audience?: string;
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
}

// ── Entity wrappers produced/consumed by the built-in plugins ──

export interface ContactEntity {
  kind: "contact";
  contact: {
    id: string;
    given: string | null;
    family: string | null;
    displayName: string | null;
    email: string | null;
    birthDate: string | null;
    genderName: string | null;
  };
}

export interface WorkerEntity {
  kind: "worker";
  worker: {
    id: string;
    contactId: string;
    jobTitle: string | null;
    siriusId: number | null;
    homeEmployerId: string | null;
    employerIds: string[] | null;
    wsId: string | null;
    msIds: string[] | null;
    bargainingUnitId: string | null;
  };
  contact: ContactEntity["contact"] | null;
}

export interface EmployerEntity {
  kind: "employer";
  employer: { id: string; name: string };
}

export interface SystemEntity {
  kind: "system";
  now: Date;
}

export interface AddressEntity {
  kind: "address";
  address: {
    street: string;
    city: string;
    state: string;
    postalCode: string;
    country: string | null;
  };
}

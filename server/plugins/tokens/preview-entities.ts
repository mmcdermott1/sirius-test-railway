import type { TokenEntity, TokenEntityType } from "./types";

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
 */
export interface TokenPreviewEntityProvider {
  /**
   * Component that must be enabled for this kind's data to be visible.
   * Enforced by every preview endpoint (search AND load) — providers for
   * component-owned entities MUST declare it or they leak disabled-
   * component data through the generic studio endpoints.
   */
  requiredComponent?: string;
  /** Search entities by free text; empty query returns recent/any. */
  search(query: string): Promise<TokenPreviewEntityRef[]>;
  /** Load one entity by id for rendering; null when it no longer exists. */
  load(id: string): Promise<TokenEntity | null>;
}

const providers = new Map<TokenEntityType, TokenPreviewEntityProvider>();

/**
 * Register the real-record preview provider for a token entity kind.
 * Declared ONCE per kind (not per notifier/surface) — every editor
 * surface that renders templates rooted at this kind inherits it.
 */
export function registerTokenPreviewEntities(
  kind: TokenEntityType,
  provider: TokenPreviewEntityProvider,
): void {
  if (providers.has(kind)) {
    throw new Error(`Token preview entities already registered for kind "${kind}"`);
  }
  providers.set(kind, provider);
}

export function getTokenPreviewEntities(
  kind: TokenEntityType,
): TokenPreviewEntityProvider | undefined {
  return providers.get(kind);
}

export function hasTokenPreviewEntities(kind: TokenEntityType): boolean {
  return providers.has(kind);
}

/**
 * Resolve a kind's provider ONLY if its required component (when any) is
 * enabled. All request-boundary callers must use this, not the raw
 * getter, so disabled-component data can't be searched or rendered.
 */
export async function getEnabledTokenPreviewEntities(
  kind: TokenEntityType,
): Promise<TokenPreviewEntityProvider | undefined> {
  const provider = providers.get(kind);
  if (!provider) return undefined;
  if (provider.requiredComponent) {
    const { isComponentEnabled } = await import("../../modules/components");
    if (!(await isComponentEnabled(provider.requiredComponent))) return undefined;
  }
  return provider;
}

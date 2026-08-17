import { tokenPluginRegistry } from "./registry";
import type {
  TokenEntityType,
  TokenPlugin,
  TokenPreviewEntityProvider,
} from "./types";

export type {
  TokenPreviewEntityProvider,
  TokenPreviewEntityRef,
} from "./types";

/**
 * Real-record preview providers, keyed by token entity kind.
 *
 * The registry owns no registrations of its own: a provider is declared
 * as `previewEntities` on the token plugin that owns the kind (see
 * `TokenPluginMetadata`), and this module projects the plugin registry
 * into a per-kind map. One provider per kind — two plugins declaring a
 * provider for the same kind is an author error and throws.
 *
 * The projection is rebuilt on demand rather than cached, so a token
 * plugin registered after boot (some are imported lazily by the
 * notifier that uses them) is picked up without a restart. The plugin
 * registry is tiny; this walk costs nothing at preview frequency.
 */
interface RegisteredPreviewProvider {
  provider: TokenPreviewEntityProvider;
  /**
   * Component gate: the provider's own `requiredComponent`, falling
   * back to the declaring plugin's. A component-owned kind is therefore
   * gated by default — its tables can be absent from the database
   * entirely, so an unguarded search errors rather than returning
   * nothing.
   */
  requiredComponent?: string;
}

function collectProviders(): Map<TokenEntityType, RegisteredPreviewProvider> {
  const map = new Map<TokenEntityType, RegisteredPreviewProvider>();
  // list() (not listEnabledSync) — component state gates ACCESS, below;
  // a disabled component's kind still has exactly one declared provider.
  for (const plugin of tokenPluginRegistry.list()) {
    const provider = plugin.metadata.previewEntities;
    if (!provider) continue;
    const kind = plugin.metadata.outputType;
    const existing = map.get(kind);
    if (existing) {
      throw new Error(
        `Two token plugins declare preview entities for kind "${kind}" ` +
          `(${plugin.metadata.id} is the second) — declare the provider once, ` +
          `on the plugin that owns the kind.`,
      );
    }
    map.set(kind, {
      provider,
      requiredComponent:
        provider.requiredComponent ?? plugin.metadata.requiredComponent,
    });
  }
  return map;
}

/**
 * Build the projection once at boot so a duplicate declaration fails
 * loudly at startup instead of at the first preview request.
 */
export function validateTokenPreviewEntities(): number {
  return collectProviders().size;
}

export function getTokenPreviewEntities(
  kind: TokenEntityType,
): TokenPreviewEntityProvider | undefined {
  return collectProviders().get(kind)?.provider;
}

export function hasTokenPreviewEntities(kind: TokenEntityType): boolean {
  return collectProviders().has(kind);
}

/**
 * Resolve a kind's provider ONLY if its required component (when any) is
 * enabled. All request-boundary callers must use this, not the raw
 * getter, so disabled-component data can't be searched or rendered.
 */
export async function getEnabledTokenPreviewEntities(
  kind: TokenEntityType,
): Promise<TokenPreviewEntityProvider | undefined> {
  const entry = collectProviders().get(kind);
  if (!entry) return undefined;
  if (entry.requiredComponent) {
    const { isComponentEnabled } = await import("../../modules/components");
    if (!(await isComponentEnabled(entry.requiredComponent))) return undefined;
  }
  return entry.provider;
}

/** A root a template editor can seed with a real record. */
export interface TokenPreviewRoot {
  /** Entity kind of the root (what the picker searches). */
  kind: TokenEntityType;
  /** Human label for the picker ("Worker", "T631 interview"). */
  label: string;
  /** Whether a real-record provider is available for this kind here. */
  hasProvider: boolean;
  /** The root also resolves from the render's recipient contact. */
  recipientRooted: boolean;
}

/** Human name for an entity kind, taken from the plugin that owns it. */
function kindLabel(kind: TokenEntityType, plugins: TokenPlugin[]): string {
  const owner =
    plugins.find(
      (p) =>
        p.metadata.outputType === kind &&
        (p.metadata.inputTypes.includes("root") || p.metadata.inputTypes.length === 0),
    ) ?? plugins.find((p) => p.metadata.outputType === kind);
  return owner?.metadata.name ?? kind;
}

/**
 * The roots a surface's tokens can be rooted at, with whether each can
 * be previewed against a real record right now. One entry per entity
 * kind: when the surface's event kind is also a plain root (e.g. a
 * worker-rooted notifier) the two collapse into one picker.
 */
export async function listTokenPreviewRoots(
  eventKind?: TokenEntityType,
): Promise<TokenPreviewRoot[]> {
  const plugins = tokenPluginRegistry.listEnabledSync();
  const kinds = new Map<TokenEntityType, boolean>(); // kind → recipientRooted
  for (const plugin of plugins) {
    if (!plugin.metadata.inputTypes.includes("root")) continue;
    // A seedless root (system values) has no record to pick.
    if (plugin.metadata.seedless) continue;
    const kind = plugin.metadata.dynamicOutput ? eventKind : plugin.metadata.outputType;
    if (!kind) continue;
    const recipientRooted =
      Boolean(plugin.metadata.recipientRooted) || (kinds.get(kind) ?? false);
    kinds.set(kind, recipientRooted);
  }
  const roots: TokenPreviewRoot[] = [];
  for (const [kind, recipientRooted] of kinds) {
    roots.push({
      kind,
      label: kindLabel(kind, plugins),
      hasProvider: Boolean(await getEnabledTokenPreviewEntities(kind)),
      recipientRooted,
    });
  }
  return roots;
}

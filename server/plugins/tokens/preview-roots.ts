import { tokenPluginRegistry } from "./registry";
import type { TokenEntityType, TokenRecentRecordProvider } from "./types";

export type { TokenRecentRecordProvider, TokenRecentRecordRef } from "./types";

/**
 * The roots a template's tokens hang off, and the small per-kind
 * "recent records" providers a SURFACE may draw preview subjects from.
 *
 * Deliberately not a record browser: there is no search and no
 * load-by-id here. A template author previews against named sample data
 * or against a context the surface itself offers (the notifier's own
 * event records, the bulk message's own recipients) — never against an
 * arbitrary record they name, which would make every template editor a
 * back door onto the whole database.
 *
 * Providers are declared as `recentRecords` on the token plugin that
 * owns the entity kind; this module projects the plugin registry into a
 * per-kind map, rebuilt on demand so lazily registered plugins are
 * picked up without a restart.
 */
interface RegisteredRecentRecords {
  pluginId: string;
  provider: TokenRecentRecordProvider;
  /**
   * Component gate: the provider's own `requiredComponent`, falling
   * back to the declaring plugin's. A component-owned kind is therefore
   * gated by default — its tables can be absent from the database
   * entirely, so an unguarded listing errors rather than returning
   * nothing.
   */
  requiredComponent?: string;
}

function collectProviders(): Map<TokenEntityType, RegisteredRecentRecords> {
  const map = new Map<TokenEntityType, RegisteredRecentRecords>();
  // list() (not listEnabledSync) — component state gates ACCESS, below;
  // a disabled component's kind still has exactly one declared provider.
  for (const plugin of tokenPluginRegistry.list()) {
    const provider = plugin.metadata.recentRecords;
    if (!provider) continue;
    const kind = plugin.metadata.outputType;
    const existing = map.get(kind);
    if (existing) {
      throw new Error(
        `Two token plugins declare recent records for kind "${kind}" ` +
          `(${plugin.metadata.id} is the second) — declare the provider once, ` +
          `on the plugin that owns the kind.`,
      );
    }
    map.set(kind, {
      pluginId: plugin.metadata.id,
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
export function validateTokenRecentRecords(): number {
  return collectProviders().size;
}

/**
 * Resolve a kind's provider ONLY if its required component (when any) is
 * enabled. Every caller must use this, not a raw getter, so a disabled
 * component's data can't be listed or rendered.
 */
export async function getEnabledTokenRecentRecords(
  kind: TokenEntityType,
): Promise<TokenRecentRecordProvider | undefined> {
  const entry = collectProviders().get(kind);
  if (!entry) return undefined;
  if (entry.requiredComponent) {
    const { isComponentEnabled } = await import("../../modules/components");
    if (!(await isComponentEnabled(entry.requiredComponent))) return undefined;
  }
  return entry.provider;
}

/** A root the render reports on (real record vs sample data). */
export interface TokenPreviewRoot {
  /** Root NAME — the segment a chain starts with (`dispatch`, `worker`). */
  name: string;
  /** Entity kind behind the root, for the per-kind record providers. */
  kind: TokenEntityType;
  label: string;
  /** The root also resolves from the render's recipient contact. */
  recipientRooted: boolean;
}

/**
 * The roots a surface's tokens can be rooted at, one entry per ROOT
 * NAME: the ordinary roots (contact, worker, employer) plus the named
 * record roots this surface seeds. Two roots of the same kind stay two
 * roots — the render reports real-vs-sample for each of them.
 */
export function listTokenPreviewRoots(
  rootNames: string[] = [],
): TokenPreviewRoot[] {
  const named = new Set(rootNames);
  const plugins = tokenPluginRegistry.listEnabledSync();
  const roots: TokenPreviewRoot[] = [];
  for (const plugin of plugins) {
    const meta = plugin.metadata;
    if (!meta.inputTypes.includes("root")) continue;
    // A seedless root (system values) has no record behind it.
    if (meta.seedless) continue;
    // A context root exists only where the surface seeds it.
    if (meta.contextRoot && !named.has(meta.segmentName)) continue;
    if (roots.some((r) => r.name === meta.segmentName)) continue;
    roots.push({
      name: meta.segmentName,
      kind: meta.outputType,
      label: meta.name,
      recipientRooted: Boolean(meta.recipientRooted),
    });
  }
  return roots;
}

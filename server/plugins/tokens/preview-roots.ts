import { tokenPluginRegistry } from "./registry";
import type { TokenEntityType } from "./types";

/**
 * The roots a template's tokens hang off.
 *
 * A root NAME is what a chain starts with; the kind behind it is what
 * decides whether a real record can be seeded there (see
 * `preview-entities.ts`).
 */

/** A root the render reports on (real record vs sample data). */
export interface TokenPreviewRoot {
  /** Root NAME — the segment a chain starts with (`dispatch`, `worker`). */
  name: string;
  /** Entity kind behind the root, for the per-kind preview sources. */
  kind: TokenEntityType;
  label: string;
  /** The root also resolves from the render's recipient contact. */
  recipientRooted: boolean;
}

/**
 * The roots a template's tokens can be rooted at, one entry per ROOT
 * NAME: the ordinary roots (contact, worker, employer) plus the named
 * record roots the caller says its templates address. Two roots of the
 * same kind stay two roots — the render reports real-vs-sample for each
 * of them.
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

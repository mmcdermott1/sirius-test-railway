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
 * The roots a preview offers and reports on, one entry per ROOT NAME,
 * IN THE ORDER THE CALLER NAMED THEM.
 *
 * The caller names the complete list. Nothing is added implicitly:
 * which roots an author may point at a record is a statement about that
 * surface — a notifier's messages are about the records the notifier
 * declares plus the recipient, and the recipient-side roots that follow
 * a contact (worker, employer) are not separately seedable there,
 * because delivery never resolves them from anyone but the recipient.
 * A surface that does want them asks for them by name (see
 * {@link ordinaryPreviewRootNames}).
 *
 * The order is the author's, not the registry's: the list is rendered
 * as given, so a surface can lead with the record its messages are
 * really about. Two roots of the same kind stay two roots — the render
 * reports real-vs-sample for each of them.
 *
 * A name that no enabled root answers to is skipped: a root whose
 * component is off simply is not on offer.
 */
export function listTokenPreviewRoots(
  rootNames: string[] = [],
): TokenPreviewRoot[] {
  const plugins = tokenPluginRegistry.listEnabledSync();
  const roots: TokenPreviewRoot[] = [];
  for (const name of rootNames) {
    if (roots.some((r) => r.name === name)) continue;
    const meta = plugins.find(
      (p) =>
        p.metadata.segmentName === name &&
        p.metadata.inputTypes.includes("root") &&
        // A seedless root (system values) has no record behind it.
        !p.metadata.seedless,
    )?.metadata;
    if (!meta) continue;
    roots.push({
      name: meta.segmentName,
      kind: meta.outputType,
      label: meta.name,
      recipientRooted: Boolean(meta.recipientRooted),
    });
  }
  return roots;
}

/**
 * The ordinary roots — the recipient and what hangs off them (contact,
 * worker, employer) — for a surface whose templates are ABOUT the
 * recipient rather than about a record: the bulk message editor, and
 * the generic studio that has no particular subject at all.
 *
 * A surface that seeds a record of its own should think twice before
 * adding these: offering a worker seed next to a contact seed lets an
 * author preview a pairing delivery cannot produce.
 */
export function ordinaryPreviewRootNames(): string[] {
  const names: string[] = [];
  for (const plugin of tokenPluginRegistry.listEnabledSync()) {
    const meta = plugin.metadata;
    if (!meta.inputTypes.includes("root")) continue;
    if (meta.seedless) continue;
    // A context root belongs to the surface that seeds it.
    if (meta.contextRoot) continue;
    if (!names.includes(meta.segmentName)) names.push(meta.segmentName);
  }
  return names;
}

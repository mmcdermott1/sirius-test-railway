import type { Request } from "express";
import type { IStorage } from "../../storage";
import { tokenPluginRegistry } from "./registry";
import type {
  TokenEntity,
  TokenEntityType,
  TokenPreviewEntitySource,
} from "./types";

/**
 * Which token entity kinds may stand behind a preview context, and how
 * reading one of their records is gated.
 *
 * Previewing a template against a real record is a READ of that record.
 * It is therefore gated exactly like any other read of it: the kind's
 * owning token plugin declares the access policy, and the same id is
 * both checked and loaded, so the check can never end up guarding a
 * different record than the one seeded.
 *
 * FAIL CLOSED: a kind with no declaration cannot be used as a preview
 * context at all. Adding a token entity kind therefore does not quietly
 * add a new way to read its records — that takes a deliberate
 * declaration saying how it is gated.
 *
 * Declarations live in `previewEntity` on the token plugin that owns
 * the kind; this module projects the registry into a per-kind map,
 * rebuilt on demand so lazily registered plugins are picked up without
 * a restart.
 */
interface RegisteredPreviewEntity {
  pluginId: string;
  source: TokenPreviewEntitySource;
  /**
   * Component gate: the source's own `requiredComponent`, falling back
   * to the declaring plugin's. A component-owned kind is therefore
   * gated by default — its tables can be absent from the database
   * entirely, so an unguarded load errors rather than refusing.
   */
  requiredComponent?: string;
}

function collectPreviewEntities(): Map<TokenEntityType, RegisteredPreviewEntity> {
  const map = new Map<TokenEntityType, RegisteredPreviewEntity>();
  // list() (not listEnabledSync) — component state gates ACCESS, below;
  // a disabled component's kind still has exactly one declaration.
  for (const plugin of tokenPluginRegistry.list()) {
    const source = plugin.metadata.previewEntity;
    if (!source) continue;
    const kind = plugin.metadata.outputType;
    if (map.has(kind)) {
      throw new Error(
        `Two token plugins declare a preview entity source for kind "${kind}" ` +
          `(${plugin.metadata.id} is the second) — declare it once, on the ` +
          `plugin that owns the kind.`,
      );
    }
    map.set(kind, {
      pluginId: plugin.metadata.id,
      source,
      requiredComponent:
        source.requiredComponent ?? plugin.metadata.requiredComponent,
    });
  }
  return map;
}

/**
 * Build the projection once at boot so a duplicate declaration fails
 * loudly at startup instead of at the first preview request.
 */
export function validateTokenPreviewEntities(): number {
  return collectPreviewEntities().size;
}

/** Kinds that currently declare how they are gated, for diagnostics. */
export function listTokenPreviewEntityKinds(): TokenEntityType[] {
  return [...collectPreviewEntities().keys()].sort();
}

export type TokenPreviewEntityResult =
  | { ok: true; entity: TokenEntity }
  | { ok: false; status: number; message: string };

/**
 * Resolve one named record into the entity a preview can be seeded
 * with, refusing at the first thing that isn't allowed.
 *
 * Returns a result rather than throwing so the calling route decides
 * the HTTP shape; every refusal is a refusal, never a silent fallback
 * to sample data, because "your record didn't load so here's a fake
 * one" is exactly the confusion a preview must not create.
 */
export async function resolveTokenPreviewEntity(
  kind: TokenEntityType,
  id: string,
  ctx: { storage: IStorage; req: Request },
): Promise<TokenPreviewEntityResult> {
  const entry = collectPreviewEntities().get(kind);
  if (!entry) {
    return {
      ok: false,
      status: 400,
      message: `Records of kind "${kind}" cannot be used as a preview context`,
    };
  }
  if (entry.requiredComponent) {
    const { isComponentEnabled } = await import("../../modules/components");
    if (!(await isComponentEnabled(entry.requiredComponent))) {
      return {
        ok: false,
        status: 400,
        message: `Records of kind "${kind}" cannot be used as a preview context`,
      };
    }
  }

  // The read gate, against the very id that is about to be loaded.
  const { checkAccessInline } = await import(
    "../../services/access-policy-evaluator"
  );
  const access = await checkAccessInline(ctx.req, entry.source.policy, id);
  if (!access.granted) {
    return {
      ok: false,
      status: 403,
      message: access.reason || "You may not preview against that record",
    };
  }

  const entity = await entry.source.load(ctx.storage, id);
  if (!entity) {
    return { ok: false, status: 404, message: "Record not found" };
  }
  return { ok: true, entity };
}

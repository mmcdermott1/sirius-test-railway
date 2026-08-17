import type { TokenArgSpec } from "@shared/tokens";
import { tokenPluginRegistry } from "./registry";
import { buildFieldCatalog } from "./evaluate";
import type { TokenEntityType, TokenPlugin } from "./types";

/**
 * BROWSABLE token tree: one level at a time.
 *
 * The flat catalog (`buildTokenCatalog`) enumerates every chain up
 * front, which forces a depth cap and turns a rich record graph into a
 * thousand-row list. This API answers the two questions a tree picker
 * actually asks — "what roots may I start at?" and "what can I write
 * after a chain that has arrived at type X?" — so a chain of ANY depth
 * stays browsable and nothing is enumerated until the author opens it.
 *
 * Relations that carry arguments are first-class here: a child names
 * its argument spec and the exact text to append, so
 * `dispatch.worker.contact.address(primary="true").field(name="full")`
 * is reachable by clicking, not by remembering the syntax.
 */

/** One root a chain may start at, for the surface being edited. */
export interface TokenTreeRoot {
  /** Root segment name as written in templates. */
  name: string;
  label: string;
  description?: string;
  /** Entity type the root produces — expand it with `expandTokenType`. */
  type: TokenEntityType;
  /** True for a root the surface must seed (a notifier's own records). */
  contextRoot: boolean;
  /** The root's own record is picked per preview (never the recipient). */
  recipientRooted: boolean;
}

export type TokenTreeChildKind = "relation" | "leaf" | "field";

/** One thing an author can write after a chain that has arrived at a type. */
export interface TokenTreeChild {
  kind: TokenTreeChildKind;
  /** Segment name ("worker", "date", "field"). */
  segment: string;
  label: string;
  description?: string;
  /**
   * Exactly what to append to the parent chain, arguments included:
   * `.worker`, `.address(primary="true")`, `.field(name="ssn")`.
   * Required arguments with no default appear as empty strings for the
   * author (or the picker) to fill in.
   */
  suffix: string;
  /** Relations only: the type produced, to expand next. */
  outputType?: TokenEntityType;
  /** Declared arguments, so a picker can offer them as inputs. */
  args?: Record<string, TokenArgSpec>;
  /** True when an argument must be filled before the token resolves. */
  needsArgument?: boolean;
  /** Relations only: field the kind renders when the chain stops here. */
  defaultLeaf?: string;
  defaultValue?: string;
  example?: string;
}

/** Everything reachable from one entity type. */
export interface TokenTypeExpansion {
  type: TokenEntityType;
  label: string;
  /** The type's field names can't be enumerated — any name is accepted. */
  fieldsOpen: boolean;
  children: TokenTreeChild[];
}

/** Human name for an entity kind, from the plugin that owns it. */
function kindLabel(type: TokenEntityType, plugins: TokenPlugin[]): string {
  const owner =
    plugins.find(
      (p) =>
        p.metadata.outputType === type &&
        (p.metadata.inputTypes.includes("root") || p.metadata.inputTypes.length === 0),
    ) ?? plugins.find((p) => p.metadata.outputType === type);
  return owner?.metadata.name ?? type;
}

/** The default leaf declared for a kind, if any. */
function defaultLeafOf(type: TokenEntityType, plugins: TokenPlugin[]): string | undefined {
  return plugins.find(
    (p) => p.metadata.outputType === type && p.metadata.defaultLeaf !== undefined,
  )?.metadata.defaultLeaf;
}

/** `(a="x", b="")` for the arguments a segment must carry, or "". */
function argSuffix(args: Record<string, TokenArgSpec> | undefined): {
  text: string;
  needsArgument: boolean;
} {
  const entries = Object.entries(args ?? {}).filter(
    ([, spec]) => spec.required || spec.default !== undefined,
  );
  // Only REQUIRED arguments are written out: an argument with a default
  // is optional noise until the author wants to change it.
  const required = entries.filter(([, spec]) => spec.required);
  if (required.length === 0) return { text: "", needsArgument: false };
  const text = required
    .map(([name, spec]) => `${name}="${spec.default ?? ""}"`)
    .join(", ");
  const needsArgument = required.some(([, spec]) => spec.default === undefined);
  return { text: `(${text})`, needsArgument };
}

/**
 * The roots a surface offers. Ordinary roots (contact, worker, system…)
 * are always there; the named record roots are offered only when the
 * surface seeds them.
 */
export function listTokenTreeRoots(rootNames: string[] = []): TokenTreeRoot[] {
  const named = new Set(rootNames);
  const plugins = tokenPluginRegistry.listEnabledSync();
  const out: TokenTreeRoot[] = [];
  // Declared order first: the records THIS message is about lead, the
  // generic roots follow.
  for (const name of rootNames) {
    const plugin = plugins.find(
      (p) => p.metadata.contextRoot && p.metadata.segmentName === name,
    );
    if (!plugin) continue;
    out.push({
      name,
      label: plugin.metadata.name,
      description: plugin.metadata.description,
      type: plugin.metadata.outputType,
      contextRoot: true,
      recipientRooted: false,
    });
  }
  for (const plugin of plugins) {
    if (!plugin.metadata.inputTypes.includes("root")) continue;
    if (plugin.metadata.hiddenFromCatalog) continue;
    if (plugin.metadata.contextRoot) continue;
    if (named.has(plugin.metadata.segmentName)) continue;
    out.push({
      name: plugin.metadata.segmentName,
      label: plugin.metadata.name,
      description: plugin.metadata.description,
      type: plugin.metadata.outputType,
      contextRoot: false,
      recipientRooted: Boolean(plugin.metadata.recipientRooted),
    });
  }
  return out;
}

/**
 * What can follow a chain that has arrived at `type`: its relations
 * (with their arguments), its value leaves, and its field names.
 *
 * Hidden-from-catalog plugins ARE included: hiding keeps them out of
 * the flat bulk-messaging list, but an author who has already navigated
 * to the type they hang off is entitled to see them.
 */
export function expandTokenType(type: TokenEntityType): TokenTypeExpansion {
  const plugins = tokenPluginRegistry.listEnabledSync();
  const catalog = buildFieldCatalog()[type];
  const children: TokenTreeChild[] = [];

  for (const plugin of plugins) {
    const meta = plugin.metadata;
    const applies =
      meta.inputTypes.includes(type) ||
      (meta.inputTypes.includes("*") && type !== "root" && type !== "value");
    if (!applies) continue;
    // The generic field segment is presented as the type's field list
    // below, not as one opaque "field(name=…)" child.
    if (meta.segmentName === "field") continue;
    const { text, needsArgument } = argSuffix(meta.args);
    if (meta.outputType === "value") {
      children.push({
        kind: "leaf",
        segment: meta.segmentName,
        label: meta.name,
        description: meta.description,
        suffix: `.${meta.segmentName}${text}`,
        args: meta.args,
        needsArgument,
        defaultValue: meta.defaultValue,
        example: meta.example,
      });
    } else {
      children.push({
        kind: "relation",
        segment: meta.segmentName,
        label: meta.name,
        description: meta.description,
        suffix: `.${meta.segmentName}${text}`,
        outputType: meta.outputType,
        args: meta.args,
        needsArgument,
        defaultLeaf: defaultLeafOf(meta.outputType, plugins),
      });
    }
  }

  const fieldsOpen = Boolean(catalog?.open);
  for (const name of catalog?.names ?? []) {
    children.push({
      kind: "field",
      segment: "field",
      label: name,
      suffix: `.field(name="${name}")`,
    });
  }
  if (fieldsOpen) {
    // Nothing to enumerate: offer the template the author completes.
    children.push({
      kind: "field",
      segment: "field",
      label: "Field…",
      description: "Any field of this record",
      suffix: '.field(name="")',
      needsArgument: true,
    });
  }

  return {
    type,
    label: kindLabel(type, plugins),
    fieldsOpen,
    children,
  };
}

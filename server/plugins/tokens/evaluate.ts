import {
  TOKEN_PATTERN,
  parseTokenChain,
  validateChain,
  normalizeFieldName,
  escapeHtml,
  type TokenSegment,
  type TokenSegmentSpec,
  type TokenFieldCatalog,
  type TokenCatalogEntry,
} from "@shared/tokens";
import { getTableColumns } from "drizzle-orm";
import type { IStorage } from "../../storage";
import {
  tokenPluginRegistry,
  findSegmentPlugin,
  tokenRegistryVersion,
} from "./registry";
import { sampleSetValue } from "./sample-sets";
import { getComponentCacheRevision } from "../../services/component-cache";
import type {
  TokenEntity,
  TokenEvalContext,
  TokenEntityType,
  TokenPlugin,
  TokenRootSeed,
} from "./types";

/**
 * Build the serializable segment graph for static validation / pickers.
 * Context roots (a notifier's seeded records, the `event` envelope) are
 * excluded: nothing seeds them here, so bulk templates treat
 * `{{dispatch.…}}` / `{{event.…}}` as unknown tokens.
 */
export function buildSegmentSpecs(): TokenSegmentSpec[] {
  return tokenPluginRegistry
    .listEnabledSync()
    .filter((p) => !p.metadata.contextRoot)
    .map(specOf);
}

function specOf(p: TokenPlugin): TokenSegmentSpec {
  return {
    name: p.metadata.segmentName,
    inputTypes: p.metadata.inputTypes,
    outputType: p.metadata.outputType,
    args: p.metadata.args,
    label: p.metadata.name,
    description: p.metadata.description,
    defaultLeaf: p.metadata.defaultLeaf,
  };
}

/**
 * Return the default-leaf field name declared for the given entity kind,
 * or undefined if the kind has no default leaf. Looks up the first
 * registered plugin whose outputType matches and declares a defaultLeaf.
 */
function getDefaultLeafForKind(kind: TokenEntityType): string | undefined {
  return tokenPluginRegistry
    .listEnabledSync()
    .find((p) => p.metadata.outputType === kind && p.metadata.defaultLeaf !== undefined)
    ?.metadata.defaultLeaf;
}

/**
 * Segment graph for a surface that seeds named record roots (a
 * token-templated event notifier): the ordinary graph PLUS the context
 * roots this surface actually seeds. A root the surface does not seed
 * stays unknown, so an author can't write a token about a record this
 * message never has.
 */
export function buildSegmentSpecsForRoots(rootNames: string[]): TokenSegmentSpec[] {
  const named = new Set(rootNames);
  return tokenPluginRegistry
    .listEnabledSync()
    .filter((p) => !p.metadata.contextRoot || named.has(p.metadata.segmentName))
    .map(specOf);
}

/**
 * Valid field(name=…) names per entity type, derived from the LIVE
 * Drizzle schema of each entity plugin's declared table (plus derived
 * extras). Never hardcoded — new columns are picked up automatically.
 */
let fieldCatalogCache: TokenFieldCatalog | null = null;
let fieldCatalogVersion = "";

/**
 * Cached field catalog. The Drizzle schema is static, but what the
 * catalog is built FROM is not: plugins can register after the first
 * render (a notifier module declaring its named record roots), a shared
 * root can gain merged fields, and enabling a component changes which
 * plugins the catalog walks. The key covers all three, so validation
 * (which builds fresh) and delivery (which reads this) can never
 * disagree about whether a field name exists.
 */
export function getFieldCatalog(): TokenFieldCatalog {
  const version = `${tokenRegistryVersion()}:${getComponentCacheRevision()}`;
  if (!fieldCatalogCache || fieldCatalogVersion !== version) {
    fieldCatalogCache = buildFieldCatalog();
    fieldCatalogVersion = version;
  }
  return fieldCatalogCache;
}

export function buildFieldCatalog(): TokenFieldCatalog {
  const catalog: TokenFieldCatalog = {};
  for (const p of tokenPluginRegistry.listEnabledSync()) {
    const type = p.metadata.outputType;
    if (type === "value") continue;
    const entry = (catalog[type] ??= { names: [] });
    if (p.metadata.entityTable) {
      for (const col of Object.values(getTableColumns(p.metadata.entityTable))) {
        if (!entry.names.includes(col.name)) entry.names.push(col.name);
      }
    }
    for (const name of p.metadata.entityFields ?? []) {
      if (!entry.names.includes(name)) entry.names.push(name);
    }
    if (p.metadata.entityFieldsOpen || (!p.metadata.entityTable && !p.metadata.entityFields)) {
      entry.open = true;
    }
  }
  return catalog;
}

export interface TokenEvalContextOptions {
  /**
   * Preview only: a chain whose root has no seed renders sample values.
   * Seeded roots still resolve for real, so one render can mix the two.
   */
  sample?: boolean;
  cache?: Map<string, unknown>;
  /**
   * Real records seeding the roots of this render, each under the ROOT
   * NAME a chain starts with (`dispatch`, `contact`, `event`). Anything
   * not seeded here falls back to the recipient (recipient-rooted
   * roots) or to sample values.
   */
  seeds?: TokenRootSeed[];
  /**
   * Which named sample persona sample-mode chains render (see
   * `TokenSampleSet`). Preview only.
   */
  sampleSetId?: string;
}

export function createTokenEvalContext(
  storage: IStorage,
  contactId?: string,
  options?: TokenEvalContextOptions,
): TokenEvalContext {
  const roots: Record<string, TokenEntity> = {};
  for (const seed of options?.seeds ?? []) roots[seed.name] = seed.entity;
  return {
    storage,
    contactId,
    now: new Date(),
    sample: options?.sample,
    sampleSetId: options?.sampleSetId,
    roots,
    cache: options?.cache ?? new Map(),
    vars: {},
  };
}

/**
 * Whether the root a chain starts at has a real record behind it —
 * either a seeded record of its own kind, or (for recipient-rooted
 * roots such as `contact`/`worker`/`employer`) the render's recipient.
 * Sample fallback applies per root: an unseeded root renders samples
 * while a seeded one, in the same render, resolves for real.
 */
function rootIsSeeded(ctx: TokenEvalContext, plugin: TokenPlugin): boolean {
  if (ctx.roots[plugin.metadata.segmentName]) return true;
  if (plugin.metadata.recipientRooted && ctx.contactId) return true;
  // A seedless root (system values) has no record to pick and nothing
  // personal behind it: this deployment's URL and today's date are the
  // same in a preview as at delivery, so it ALWAYS resolves for real —
  // even in an all-sample render. A fake origin makes the preview's link
  // unclickable and a frozen fake date hides date-format mistakes, both
  // of which the author is previewing to catch.
  if (plugin.metadata.seedless) return true;
  return false;
}

/**
 * What a value leaf renders in sample mode. The chosen sample persona
 * wins when it names this leaf, so one pick renders a coherent story
 * across the whole template; otherwise the token's own declared sample
 * data applies (which is what a kind with no named set always uses).
 *
 * `entityKind` is the kind the leaf reads FROM — the chain's current
 * type at the leaf, not the leaf's own output type.
 */
function sampleLeafValue(
  ctx: TokenEvalContext,
  entityKind: TokenEntityType,
  plugin: TokenPlugin,
  args: Record<string, string>,
): string {
  // Plain field leaves are named by their field argument; every other
  // leaf ({{worker.member_status}}) by its segment name.
  const key =
    plugin.metadata.segmentName === "field" && args.name
      ? args.name
      : plugin.metadata.segmentName;
  return (
    sampleSetValue(entityKind, ctx.sampleSetId, key) ??
    plugin.sampleValue?.(args) ??
    plugin.metadata.example ??
    plugin.metadata.defaultValue ??
    ""
  );
}

function applyArgDefaults(
  plugin: TokenPlugin,
  args: Record<string, string>,
): Record<string, string> {
  const out: Record<string, string> = { ...args };
  for (const [key, spec] of Object.entries(plugin.metadata.args || {})) {
    if (out[key] === undefined && spec.default !== undefined) {
      out[key] = spec.default;
    }
  }
  return out;
}

export type ChainEvalResult =
  | { status: "ok"; value: string }
  | { status: "missing"; defaultValue: string }
  | { status: "invalid"; error: string };

/**
 * Evaluate a parsed chain to a final string. Fold left: each segment's
 * plugin receives the previous entity and produces the next one.
 */
export async function evaluateChain(
  segments: TokenSegment[],
  ctx: TokenEvalContext,
): Promise<ChainEvalResult> {
  let currentType: TokenEntityType = "root";
  let entity: unknown = null;
  let leaf: TokenPlugin | undefined;
  // Sample-vs-real is decided once per chain, by its root: the whole
  // chain renders samples only when sample fallback is on AND the root
  // it hangs off has no real record behind it.
  let sample = Boolean(ctx.sample);

  for (const seg of segments) {
    const plugin = findSegmentPlugin(seg.name, currentType);
    if (!plugin) {
      return {
        status: "invalid",
        error: `unknown segment '${seg.name}' for type '${currentType}'`,
      };
    }
    if (currentType === "root") sample = Boolean(ctx.sample) && !rootIsSeeded(ctx, plugin);
    leaf = plugin;
    const declaredArgs = plugin.metadata.args || {};
    for (const key of Object.keys(seg.args)) {
      if (!declaredArgs[key]) {
        return {
          status: "invalid",
          error: `unknown argument '${key}' on '${seg.name}'`,
        };
      }
    }
    const args = applyArgDefaults(plugin, seg.args);
    for (const [key, spec] of Object.entries(declaredArgs)) {
      if (spec.required && args[key] === undefined) {
        return {
          status: "invalid",
          error: `missing required argument '${key}' on '${seg.name}'`,
        };
      }
    }
    // Enforce schema field validation on the render path too — an
    // unknown field of a closed entity type is an INVALID token (same
    // outcome as editor warnings/coverage), not a silent default.
    if (seg.name === "field" && args.name !== undefined) {
      const catalog = getFieldCatalog()[currentType];
      if (catalog && !catalog.open) {
        const wanted = normalizeFieldName(args.name);
        if (!catalog.names.some((n) => normalizeFieldName(n) === wanted)) {
          return {
            status: "invalid",
            error: `'${args.name}' is not a field of ${currentType}`,
          };
        }
      }
    }
    if (sample && plugin.metadata.outputType === "value") {
      return { status: "ok", value: sampleLeafValue(ctx, currentType, plugin, args) };
    }
    if (!sample && entity === null && currentType !== "root") {
      // an intermediate segment resolved to nothing — chain is missing
      return { status: "missing", defaultValue: leafDefault(segments) };
    }
    entity = sample ? {} : await plugin.resolve(entity, args, ctx);
    ctx.vars.entity = entity;
    currentType = plugin.metadata.outputType;
  }

  if (currentType !== "value") {
    // Default-leaf desugaring: if the chain ends in an entity kind that
    // has a declared default leaf, implicitly evaluate field(name=<leaf>)
    // without requiring the author to write it explicitly.
    const defaultLeafName = getDefaultLeafForKind(currentType);
    if (defaultLeafName !== undefined) {
      const fieldPlugin = findSegmentPlugin("field", currentType);
      if (fieldPlugin) {
        const args = applyArgDefaults(fieldPlugin, { name: defaultLeafName });
        if (sample) {
          return {
            status: "ok",
            value: sampleLeafValue(ctx, currentType, fieldPlugin, args),
          };
        }
        if (entity === null) {
          return { status: "missing", defaultValue: fieldPlugin.metadata.defaultValue ?? "" };
        }
        const resolved = await fieldPlugin.resolve(entity, args, ctx);
        const defaultValue = fieldPlugin.metadata.defaultValue ?? "";
        if (resolved === null || resolved === undefined || resolved === "") {
          return { status: "missing", defaultValue };
        }
        return { status: "ok", value: String(resolved) };
      }
    }
    return { status: "invalid", error: "chain does not end in a value" };
  }
  const defaultValue = leaf?.metadata.defaultValue ?? "";
  if (entity === null || entity === undefined || entity === "") {
    return { status: "missing", defaultValue };
  }
  return { status: "ok", value: String(entity) };
}

function leafDefault(segments: TokenSegment[]): string {
  // Find the leaf plugin's default by walking the types statically.
  let currentType: TokenEntityType = "root";
  let def = "";
  for (const seg of segments) {
    const plugin = findSegmentPlugin(seg.name, currentType);
    if (!plugin) break;
    def = plugin.metadata.defaultValue ?? "";
    currentType = plugin.metadata.outputType;
  }
  // If the chain ends at an entity kind with a default leaf, the effective
  // default comes from the field plugin (which has no per-field default).
  if (currentType !== "value") {
    const defaultLeafName = getDefaultLeafForKind(currentType);
    if (defaultLeafName !== undefined) {
      const fieldPlugin = findSegmentPlugin("field", currentType);
      if (fieldPlugin) return fieldPlugin.metadata.defaultValue ?? def;
    }
  }
  return def;
}

export interface RenderResult {
  output: string;
  /** Expressions that failed to parse or validate. */
  unknownTokens: string[];
  /** Expressions that resolved empty (default was used). */
  missingValues: string[];
  /**
   * Expressions that contributed NOTHING to the output — the rendered
   * replacement was the empty string. That covers a value token whose
   * sample data is missing and a missing value whose default is itself
   * empty. Reported separately from `missingValues` so a preview can
   * tell "this token produced an empty value" (a hole the reader will
   * never see) apart from "this token rendered its sample/default".
   */
  emptyValues: string[];
}

export interface RenderOptions {
  /**
   * Escape token values for safe HTML interpolation. Values from
   * plugins that declare `emitsHtml` are inserted verbatim (the plugin
   * is responsible for sanitizing).
   */
  escapeHtml?: boolean;
  /**
   * When true, invalid chains render as a visible
   * "[unknown token: …]" marker; otherwise they are left as-is.
   */
  strictUnknown?: boolean;
}

/** Render a template, evaluating every chained token expression. */
export async function renderTokens(
  template: string,
  ctx: TokenEvalContext,
  options: RenderOptions = {},
): Promise<RenderResult> {
  const unknownTokens: string[] = [];
  const missingValues: string[] = [];
  const emptyValues: string[] = [];

  const matches = Array.from(template.matchAll(TOKEN_PATTERN));
  if (matches.length === 0) {
    return { output: template, unknownTokens, missingValues, emptyValues };
  }

  let output = "";
  let cursor = 0;
  for (const m of matches) {
    output += template.slice(cursor, m.index);
    cursor = (m.index ?? 0) + m[0].length;
    const expr = m[1];

    const parsed = parseTokenChain(expr);
    let replacement: string;
    if (!parsed.ok) {
      unknownTokens.push(expr);
      replacement = options.strictUnknown ? `[unknown token: ${expr}]` : m[0];
    } else {
      const result = await evaluateChain(parsed.segments, ctx);
      if (result.status === "invalid") {
        unknownTokens.push(expr);
        replacement = options.strictUnknown ? `[unknown token: ${expr}]` : m[0];
      } else {
        let value: string;
        if (result.status === "missing") {
          missingValues.push(expr);
          value = result.defaultValue;
        } else {
          value = result.value;
        }
        // A token that renders to nothing is invisible in the output —
        // report it so the studio can flag the hole instead of leaving
        // the admin to spot a gap between two spaces.
        if (value === "") emptyValues.push(expr);
        const leaf = leafPluginFor(parsed.segments);
        replacement =
          options.escapeHtml && !leaf?.metadata.emitsHtml
            ? escapeHtml(value)
            : value;
      }
    }
    output += replacement;
  }
  output += template.slice(cursor);
  return { output, unknownTokens, missingValues, emptyValues };
}

function leafPluginFor(segments: TokenSegment[]): TokenPlugin | undefined {
  let currentType: TokenEntityType = "root";
  let leaf: TokenPlugin | undefined;
  for (const seg of segments) {
    const plugin = findSegmentPlugin(seg.name, currentType);
    if (!plugin) return undefined;
    leaf = plugin;
    currentType = plugin.metadata.outputType;
  }
  // When the chain ends at an entity kind with a default leaf, the
  // effective leaf for rendering purposes is the generic field plugin.
  if (currentType !== "value" && getDefaultLeafForKind(currentType) !== undefined) {
    return findSegmentPlugin("field", currentType) ?? leaf;
  }
  return leaf;
}

/** Validate one expression against the live registry and schema. */
export function validateTokenExpression(
  expr: string,
): { ok: true } | { ok: false; error: string } {
  const parsed = parseTokenChain(expr);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = validateChain(parsed.segments, buildSegmentSpecs(), buildFieldCatalog());
  if (!v.ok) return { ok: false, error: v.error };
  return { ok: true };
}

/**
 * Validate one expression for a surface that seeds named record roots
 * (token-templated event notifiers): the ordinary graph plus exactly
 * the roots this surface seeds.
 */
export function validateTokenExpressionForRoots(
  expr: string,
  rootNames: string[],
): { ok: true } | { ok: false; error: string } {
  const parsed = parseTokenChain(expr);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = validateChain(
    parsed.segments,
    buildSegmentSpecsForRoots(rootNames),
    buildFieldCatalog(),
  );
  if (!v.ok) return { ok: false, error: v.error };
  return { ok: true };
}

/** Metadata about the leaf of a valid chain (labels, defaults, examples). */
export function describeChain(
  expr: string,
): { label: string; defaultValue: string; example: string; scope: string } | null {
  const parsed = parseTokenChain(expr);
  if (!parsed.ok) return null;
  const leaf = leafPluginFor(parsed.segments);
  if (!leaf) return null;
  const last = parsed.segments[parsed.segments.length - 1];
  // Determine the output type of the last written segment so we can check
  // for a default-leaf desugaring when the chain doesn't end in "field".
  let lastOutputType: TokenEntityType = "root";
  for (const seg of parsed.segments) {
    const p = findSegmentPlugin(seg.name, lastOutputType);
    if (!p) break;
    lastOutputType = p.metadata.outputType;
  }
  let label: string;
  if (last?.name === "field" && last.args.name) {
    label = `${last.args.name} field`;
  } else {
    const dl = getDefaultLeafForKind(lastOutputType);
    label = dl !== undefined ? `${dl} field` : leaf.metadata.name;
  }
  return {
    label,
    defaultValue: last?.args.default ?? leaf.metadata.defaultValue ?? "",
    example: leaf.metadata.example ?? "",
    scope: parsed.segments[0]?.name ?? "system",
  };
}

/**
 * Build the FLAT picker catalog by walking root → (relation)* chains
 * over the enabled registry. Entity segments contribute ONE entry each
 * — a `field(name="")` template the author completes — so the catalog
 * never needs updating when the schema changes. Plain value leaves
 * (system.year etc.) contribute a direct entry.
 *
 * The walk is depth-capped because it is EAGER: it enumerates every
 * reachable chain up front, and the relation graph has cycles
 * (worker → contact → worker). Browsing deeper than the cap is the
 * tree API's job (`./tree`), which expands one type at a time on
 * demand and therefore has no depth limit at all.
 */
export function buildTokenCatalog(): TokenCatalogEntry[] {
  return buildCatalogEntries();
}

/**
 * Flat catalog for a surface that seeds named record roots (an event
 * notifier): the normal catalog PLUS entries under each root it seeds.
 * Those roots' relation plugins are `hiddenFromCatalog` (they'd be
 * noise in bulk messaging, where no such record exists), so the walk
 * under a context root uses the full registry rather than the visible
 * subset.
 */
export function buildTokenCatalogForRoots(rootNames: string[]): TokenCatalogEntry[] {
  return buildCatalogEntries(rootNames);
}

function buildCatalogEntries(rootNames: string[] = []): TokenCatalogEntry[] {
  const all = tokenPluginRegistry.listEnabledSync();
  const enabled = all.filter((p) => !p.metadata.hiddenFromCatalog);
  const fieldCatalog = buildFieldCatalog();
  const roots = enabled.filter(
    (p) => p.metadata.inputTypes.includes("root") && !p.metadata.contextRoot,
  );
  const entries: TokenCatalogEntry[] = [];

  const emitEntityEntry = (prefix: string, scope: string, label: string, type: TokenEntityType) => {
    const fields = fieldCatalog[type];
    const names = fields?.names ?? [];
    // A name or two as a hint — never the whole column list, which
    // turns every row of the picker into a wall of text.
    const description = names.length
      ? `Any field of this record (${names.slice(0, 3).join(", ")}${names.length > 3 ? ", …" : ""})`
      : "Any field of this record";
    // Short-form entry: when a default leaf is declared for this entity kind,
    // emit a directly-insertable entry (e.g. `worker.contact` →
    // the contact's display_name) in addition to the template entry.
    const dl = getDefaultLeafForKind(type);
    if (dl !== undefined) {
      entries.push({
        id: prefix,
        label: `${label} (${dl})`,
        description: `${dl} — default field (insert as {{${prefix}}})`,
        scope,
        insertText: `{{${prefix}}}`,
        defaultValue: "",
        example: "",
      });
    }
    const id = `${prefix}.field(name="")`;
    entries.push({
      id,
      label: `${label} field…`,
      description,
      scope,
      insertText: `{{${prefix}.field(name="")}}`,
      defaultValue: "",
      example: "",
    });
  };

  const walk = (
    prefix: string,
    scope: string,
    rootLabel: string,
    type: TokenEntityType,
    depth: number,
    pool: typeof enabled = enabled,
  ) => {
    if (type !== "value" && type !== "system") {
      emitEntityEntry(prefix, scope, rootLabel, type);
    }
    for (const p of pool) {
      if (!p.metadata.inputTypes.includes(type)) continue;
      if (p.metadata.outputType === "value") {
        const hasRequired = Object.values(p.metadata.args || {}).some(
          (a) => a.required && a.default === undefined,
        );
        if (hasRequired) continue; // field(...) is covered by entity entries
        const id = `${prefix}.${p.metadata.segmentName}`;
        entries.push({
          id,
          label: `${rootLabel} ${p.metadata.shortLabel ?? p.metadata.name}`,
          description: p.metadata.description ?? "",
          scope,
          insertText: `{{${id}}}`,
          defaultValue: p.metadata.defaultValue ?? "",
          example: p.metadata.example ?? "",
        });
      } else if (depth < 2 && !p.metadata.inputTypes.includes("root")) {
        walk(
          `${prefix}.${p.metadata.segmentName}`,
          scope,
          `${rootLabel} ${p.metadata.shortLabel ?? p.metadata.name.toLowerCase()}`,
          p.metadata.outputType,
          depth + 1,
          pool,
        );
      }
    }
  };

  for (const root of roots) {
    walk(
      root.metadata.segmentName,
      root.metadata.segmentName,
      root.metadata.name,
      root.metadata.outputType,
      0,
    );
  }

  // Context roots this surface seeds (a notifier's records, the event
  // envelope). Walked with the FULL registry so the hidden per-kind
  // relation plugins (e.g. interview → worker) are reachable. Entity
  // descriptor plugins (`inputTypes: []`) never match a segment, so
  // including them here is harmless.
  for (const name of rootNames) {
    const root = all.find(
      (p) => p.metadata.contextRoot && p.metadata.segmentName === name,
    );
    if (!root) continue;
    walk(name, name, root.metadata.name, root.metadata.outputType, 0, all);
  }
  return entries;
}

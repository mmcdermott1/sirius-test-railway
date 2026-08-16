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
import { tokenPluginRegistry, findSegmentPlugin } from "./registry";
import type {
  TokenEvalContext,
  TokenEntityType,
  TokenPlugin,
} from "./types";

/** Build the serializable segment graph for static validation / pickers. */
export function buildSegmentSpecs(): TokenSegmentSpec[] {
  // Dynamic-output segments (the `event` root) are excluded: their
  // produced type depends on the event context, which bulk messaging
  // never has, so bulk templates treat `event` as unknown.
  return tokenPluginRegistry
    .listEnabledSync()
    .filter((p) => !p.metadata.dynamicOutput)
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
 * Segment graph for a surface that renders with a known event entity
 * kind (token-templated event notifiers): dynamic-output roots are
 * included with the concrete `eventKind` as their output type, so
 * `{{event.…}}` chains validate statically.
 */
export function buildSegmentSpecsForEvent(eventKind: TokenEntityType): TokenSegmentSpec[] {
  return tokenPluginRegistry.listEnabledSync().map((p) => {
    const spec = specOf(p);
    return p.metadata.dynamicOutput ? { ...spec, outputType: eventKind } : spec;
  });
}

/**
 * Valid field(name=…) names per entity type, derived from the LIVE
 * Drizzle schema of each entity plugin's declared table (plus derived
 * extras). Never hardcoded — new columns are picked up automatically.
 */
let fieldCatalogCache: TokenFieldCatalog | null = null;

/** Cached field catalog — the registry and schema are static after boot. */
function getFieldCatalog(): TokenFieldCatalog {
  return (fieldCatalogCache ??= buildFieldCatalog());
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

export function createTokenEvalContext(
  storage: IStorage,
  contactId?: string,
  options?: {
    sample?: boolean;
    cache?: Map<string, unknown>;
    event?: import("./types").TokenEntity;
  },
): TokenEvalContext {
  return {
    storage,
    contactId,
    now: new Date(),
    sample: options?.sample,
    event: options?.event,
    cache: options?.cache ?? new Map(),
    vars: {},
  };
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

  for (const seg of segments) {
    const plugin = findSegmentPlugin(seg.name, currentType);
    if (!plugin) {
      return {
        status: "invalid",
        error: `unknown segment '${seg.name}' for type '${currentType}'`,
      };
    }
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
    if (ctx.sample && plugin.metadata.outputType === "value") {
      const example =
        plugin.sampleValue?.(args) ??
        plugin.metadata.example ??
        plugin.metadata.defaultValue ??
        "";
      return { status: "ok", value: example };
    }
    if (!ctx.sample && entity === null && currentType !== "root") {
      // an intermediate segment resolved to nothing — chain is missing
      return { status: "missing", defaultValue: leafDefault(segments, ctx.event?.kind) };
    }
    entity = ctx.sample ? {} : await plugin.resolve(entity, args, ctx);
    ctx.vars.entity = entity;
    // Dynamic-output segments (the `event` root) advance the chain to
    // the RESOLVED entity's kind — the produced type is declared by the
    // notifier that built the event entity, not by the plugin.
    if (plugin.metadata.dynamicOutput) {
      // In sample mode the entity is always {} (no real DB resolve), so
      // fall back to the context's event kind when available — this lets
      // {{event.*}} chains advance to the right entity type and return
      // sample values instead of "missing" in preview/coverage runs.
      const e = ctx.sample
        ? (ctx.event ?? null)
        : (entity as { kind?: unknown } | null);
      if (!e || typeof e !== "object" || typeof (e as Record<string, unknown>).kind !== "string") {
        return { status: "missing", defaultValue: plugin.metadata.defaultValue ?? "" };
      }
      currentType = (e as Record<string, unknown>).kind as string;
    } else {
      currentType = plugin.metadata.outputType;
    }
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
        if (ctx.sample) {
          const example =
            fieldPlugin.sampleValue?.(args) ??
            fieldPlugin.metadata.example ??
            fieldPlugin.metadata.defaultValue ??
            "";
          return { status: "ok", value: example };
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

function leafDefault(segments: TokenSegment[], eventKind?: string): string {
  // Find the leaf plugin's default by walking the types statically.
  let currentType: TokenEntityType = "root";
  let def = "";
  for (const seg of segments) {
    const plugin = findSegmentPlugin(seg.name, currentType);
    if (!plugin) break;
    def = plugin.metadata.defaultValue ?? "";
    if (plugin.metadata.dynamicOutput) {
      if (!eventKind) break; // can't advance statically without a kind
      currentType = eventKind;
    } else {
      currentType = plugin.metadata.outputType;
    }
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

  const matches = Array.from(template.matchAll(TOKEN_PATTERN));
  if (matches.length === 0) {
    return { output: template, unknownTokens, missingValues };
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
        const leaf = leafPluginFor(parsed.segments, ctx.event?.kind);
        replacement =
          options.escapeHtml && !leaf?.metadata.emitsHtml
            ? escapeHtml(value)
            : value;
      }
    }
    output += replacement;
  }
  output += template.slice(cursor);
  return { output, unknownTokens, missingValues };
}

function leafPluginFor(
  segments: TokenSegment[],
  eventKind?: string,
): TokenPlugin | undefined {
  let currentType: TokenEntityType = "root";
  let leaf: TokenPlugin | undefined;
  for (const seg of segments) {
    const plugin = findSegmentPlugin(seg.name, currentType);
    if (!plugin) return undefined;
    leaf = plugin;
    if (plugin.metadata.dynamicOutput) {
      // Without a concrete kind the leaf can't be resolved statically;
      // callers treat `undefined` conservatively (values get escaped).
      if (!eventKind) return undefined;
      currentType = eventKind;
    } else {
      currentType = plugin.metadata.outputType;
    }
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
 * Validate one expression for a surface whose `event` root resolves to
 * a known entity kind (token-templated event notifiers).
 */
export function validateTokenExpressionForEvent(
  expr: string,
  eventKind: TokenEntityType,
): { ok: true } | { ok: false; error: string } {
  const parsed = parseTokenChain(expr);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = validateChain(
    parsed.segments,
    buildSegmentSpecsForEvent(eventKind),
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
    lastOutputType = p.metadata.dynamicOutput ? lastOutputType : p.metadata.outputType;
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
 * Build the picker catalog by walking root → (relation)* chains over
 * the enabled registry. Entity segments contribute ONE entry each — a
 * `field(name="")` template the author completes — so the catalog
 * never needs updating when the schema changes. Plain value leaves
 * (system.year etc.) contribute a direct entry. Depth is capped at 3
 * segments.
 */
export function buildTokenCatalog(): TokenCatalogEntry[] {
  return buildCatalogEntries();
}

/**
 * Catalog for an event-notifier template editor: the normal picker
 * catalog PLUS `event.*` entries rooted at the notifier's concrete
 * event entity kind. The `event` root and the per-kind relation
 * plugins are `hiddenFromCatalog` (they'd be noise in bulk messaging,
 * where no event entity exists), so the walk under the event root uses
 * the full registry rather than the visible subset.
 */
export function buildTokenCatalogForEvent(eventKind: TokenEntityType): TokenCatalogEntry[] {
  return buildCatalogEntries(eventKind);
}

function buildCatalogEntries(eventKind?: TokenEntityType): TokenCatalogEntry[] {
  const all = tokenPluginRegistry.listEnabledSync();
  const enabled = all.filter((p) => !p.metadata.hiddenFromCatalog);
  const fieldCatalog = buildFieldCatalog();
  const roots = enabled.filter((p) => p.metadata.inputTypes.includes("root"));
  const entries: TokenCatalogEntry[] = [];

  const emitEntityEntry = (prefix: string, scope: string, label: string, type: TokenEntityType) => {
    const fields = fieldCatalog[type];
    const description = fields?.names.length
      ? `Fields: ${fields.names.join(", ")}`
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

  // Event-rooted entries: substitute the concrete entity kind for the
  // dynamic `event` root and walk with the FULL registry so the
  // hidden per-kind relation plugins (e.g. interview → worker) are
  // reachable. Entity-descriptor plugins (`inputTypes: []`) never
  // match a segment, so including them here is harmless.
  if (eventKind) {
    const eventRoot = all.find(
      (p) => p.metadata.dynamicOutput && p.metadata.inputTypes.includes("root"),
    );
    if (eventRoot) {
      walk(eventRoot.metadata.segmentName, eventRoot.metadata.segmentName, "Event", eventKind, 0, all);
    }
  }
  return entries;
}

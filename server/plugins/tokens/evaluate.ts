import {
  TOKEN_PATTERN,
  parseTokenChain,
  validateChain,
  escapeHtml,
  type TokenSegment,
  type TokenSegmentSpec,
  type TokenCatalogEntry,
} from "@shared/tokens";
import type { IStorage } from "../../storage";
import { tokenPluginRegistry, findSegmentPlugin } from "./registry";
import type {
  TokenEvalContext,
  TokenEntityType,
  TokenPlugin,
} from "./types";

/** Build the serializable segment graph for static validation / pickers. */
export function buildSegmentSpecs(): TokenSegmentSpec[] {
  return tokenPluginRegistry.listEnabledSync().map((p) => ({
    name: p.metadata.segmentName,
    inputTypes: p.metadata.inputTypes,
    outputType: p.metadata.outputType,
    args: p.metadata.args,
    label: p.metadata.name,
    description: p.metadata.description,
  }));
}

export function createTokenEvalContext(
  storage: IStorage,
  contactId?: string,
  options?: { sample?: boolean; audience?: string; cache?: Map<string, unknown> },
): TokenEvalContext {
  return {
    storage,
    contactId,
    now: new Date(),
    sample: options?.sample,
    audience: options?.audience,
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
 * Audience-gated segments resolve as missing (never as an error) so
 * hidden data degrades to the default instead of leaking or breaking.
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
    // Fail closed: an audience-restricted plugin only resolves when the
    // context declares an audience that the plugin allows. A context
    // without an audience (preview, coverage) degrades to the default.
    if (
      plugin.metadata.audiences &&
      (!ctx.audience || !plugin.metadata.audiences.includes(ctx.audience))
    ) {
      return { status: "missing", defaultValue: plugin.metadata.defaultValue ?? "" };
    }
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
    if (ctx.sample && plugin.metadata.outputType === "value") {
      const example = plugin.metadata.example ?? plugin.metadata.defaultValue ?? "";
      return { status: "ok", value: example };
    }
    if (!ctx.sample && entity === null && currentType !== "root") {
      // an intermediate segment resolved to nothing — chain is missing
      return { status: "missing", defaultValue: leafDefault(segments) };
    }
    entity = ctx.sample ? {} : await plugin.resolve(entity, args, ctx);
    ctx.vars.entity = entity;
    currentType = plugin.metadata.outputType;
  }

  if (currentType !== "value") {
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
  return { output, unknownTokens, missingValues };
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
  return leaf;
}

/** Validate one expression against the live registry. */
export function validateTokenExpression(
  expr: string,
): { ok: true } | { ok: false; error: string } {
  const parsed = parseTokenChain(expr);
  if (!parsed.ok) return { ok: false, error: parsed.error };
  const v = validateChain(parsed.segments, buildSegmentSpecs());
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
  return {
    label: leaf.metadata.name,
    defaultValue: leaf.metadata.defaultValue ?? "",
    example: leaf.metadata.example ?? "",
    scope: parsed.segments[0]?.name ?? "system",
  };
}

/**
 * Build the picker catalog by walking root → (intermediate) → value
 * chains over the enabled registry. Depth is capped at 3 segments;
 * leaves with required args contribute their declared catalogVariants
 * instead of a single generic entry.
 */
export function buildTokenCatalog(): TokenCatalogEntry[] {
  const enabled = tokenPluginRegistry
    .listEnabledSync()
    .filter((p) => !p.metadata.hiddenFromCatalog);
  const roots = enabled.filter((p) => p.metadata.inputTypes.includes("root"));
  const entries: TokenCatalogEntry[] = [];

  const emitLeafEntries = (prefix: string, scope: string, rootLabel: string, type: TokenEntityType, depth: number) => {
    for (const p of enabled) {
      if (!p.metadata.inputTypes.includes(type)) continue;
      if (p.metadata.outputType === "value") {
        const hasRequired = Object.values(p.metadata.args || {}).some(
          (a) => a.required && a.default === undefined,
        );
        if (hasRequired) {
          for (const variant of p.metadata.catalogVariants || []) {
            const argText = Object.entries(variant.args)
              .map(([k, v]) => `${k}="${v}"`)
              .join(", ");
            const id = `${prefix}.${p.metadata.segmentName}(${argText})`;
            entries.push({
              id,
              label: `${rootLabel} ${variant.label}`,
              description: variant.description ?? p.metadata.description ?? "",
              scope,
              insertText: `{{${id}}}`,
              defaultValue: p.metadata.defaultValue ?? "",
              example: variant.example ?? p.metadata.example ?? "",
            });
          }
        } else {
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
        }
      } else if (depth < 2 && !p.metadata.inputTypes.includes("root")) {
        emitLeafEntries(
          `${prefix}.${p.metadata.segmentName}`,
          scope,
          rootLabel,
          p.metadata.outputType,
          depth + 1,
        );
      }
    }
  };

  for (const root of roots) {
    emitLeafEntries(
      root.metadata.segmentName,
      root.metadata.segmentName,
      root.metadata.name,
      root.metadata.outputType,
      0,
    );
  }
  return entries;
}

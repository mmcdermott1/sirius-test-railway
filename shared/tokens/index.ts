/**
 * Chained-token grammar shared by server (evaluation) and client
 * (extraction, chip rendering, static validation).
 *
 * Syntax:  {{segment.segment(arg="value").segment}}
 *   token   := '{{' chain '}}'
 *   chain   := segment ('.' segment)*
 *   segment := name [ '(' arg (',' arg)* ')' ]
 *   arg     := name '=' '"' text '"'          (\" escapes a quote)
 *
 * Each segment is resolved by a token plugin (server-side). A plugin
 * declares which entity type(s) it accepts and which it produces;
 * a chain is valid when the types line up, the first segment accepts
 * "root", and the last segment produces "value".
 *
 * This module is dependency-free and browser-safe: no plugin imports,
 * no DB access. The server exposes its registry as TokenSegmentSpec[]
 * so the client can run the same validation logic.
 */

export const MAX_CHAIN_DEPTH = 6;

/** Matches a full token incl. optional per-segment parenthesized args. */
export const TOKEN_PATTERN =
  /\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*(?:\((?:[^()"]|"(?:[^"\\]|\\.)*")*\))?(?:\.[a-zA-Z_][a-zA-Z0-9_]*(?:\((?:[^()"]|"(?:[^"\\]|\\.)*")*\))?)*)\s*\}\}/g;

export interface TokenSegment {
  name: string;
  /** Explicit arguments only; defaults are applied at evaluation time. */
  args: Record<string, string>;
}

export type ParseResult =
  | { ok: true; segments: TokenSegment[] }
  | { ok: false; error: string };

/** Parse the inside of a token (no braces) into segments. */
export function parseTokenChain(expr: string): ParseResult {
  const s = expr.trim();
  if (!s) return { ok: false, error: "empty token" };
  const segments: TokenSegment[] = [];
  let i = 0;

  const nameRe = /[a-zA-Z_][a-zA-Z0-9_]*/y;

  while (i < s.length) {
    nameRe.lastIndex = i;
    const nm = nameRe.exec(s);
    if (!nm) return { ok: false, error: `expected segment name at position ${i}` };
    const name = nm[0];
    i = nameRe.lastIndex;
    const args: Record<string, string> = {};

    if (s[i] === "(") {
      i++;
      // empty arg list "()" is allowed
      while (s[i] !== ")") {
        // skip whitespace/comma
        while (s[i] === " " || s[i] === ",") i++;
        if (s[i] === ")") break;
        nameRe.lastIndex = i;
        const an = nameRe.exec(s);
        if (!an) return { ok: false, error: `expected argument name in ${name}(...)` };
        const argName = an[0];
        i = nameRe.lastIndex;
        while (s[i] === " ") i++;
        if (s[i] !== "=") return { ok: false, error: `expected '=' after ${name}(${argName}` };
        i++;
        while (s[i] === " ") i++;
        if (s[i] !== '"') return { ok: false, error: `argument ${argName} must be a quoted string` };
        i++;
        let value = "";
        while (i < s.length && s[i] !== '"') {
          if (s[i] === "\\" && i + 1 < s.length) {
            value += s[i + 1];
            i += 2;
          } else {
            value += s[i];
            i++;
          }
        }
        if (s[i] !== '"') return { ok: false, error: `unterminated string in ${name}(${argName}=...)` };
        i++;
        args[argName] = value;
        while (s[i] === " ") i++;
        if (s[i] !== "," && s[i] !== ")") {
          return { ok: false, error: `expected ',' or ')' in ${name}(...)` };
        }
      }
      i++; // consume ')'
    }

    segments.push({ name, args });
    if (i >= s.length) break;
    if (s[i] !== ".") return { ok: false, error: `unexpected '${s[i]}' at position ${i}` };
    i++;
    if (i >= s.length) return { ok: false, error: "trailing '.'" };
  }

  if (segments.length === 0) return { ok: false, error: "empty token" };
  if (segments.length > MAX_CHAIN_DEPTH) {
    return { ok: false, error: `chain exceeds max depth of ${MAX_CHAIN_DEPTH}` };
  }
  return { ok: true, segments };
}

/** Extract the raw (inner) token expressions used in a template, deduped. */
export function extractTokenExpressions(template: string | null | undefined): string[] {
  if (!template) return [];
  const found = new Set<string>();
  for (const m of template.matchAll(TOKEN_PATTERN)) {
    found.add(m[1]);
  }
  return Array.from(found);
}

// ─────────────────────────────────────────────────────────────────
// Static chain validation against a segment-spec graph
// ─────────────────────────────────────────────────────────────────

export interface TokenArgSpec {
  required?: boolean;
  /** Applied when the author omits the argument. */
  default?: string;
  description?: string;
}

/**
 * Serializable description of one registered token plugin, enough for
 * static validation and picker UIs. The server derives these from the
 * token plugin registry and ships them to the client.
 */
export interface TokenSegmentSpec {
  /** Segment name as written in templates (e.g. "firstName"). */
  name: string;
  /** Entity types this segment can be applied to; "root" starts a chain. */
  inputTypes: string[];
  /** Entity type produced; "value" terminates a chain. */
  outputType: string;
  args?: Record<string, TokenArgSpec>;
  label?: string;
  description?: string;
}

export type ChainValidation =
  | { ok: true; outputType: string }
  | { ok: false; error: string };

/**
 * Walk a parsed chain over the segment graph: every segment must exist
 * for the current entity type, args must be known and required args
 * present (after defaults), and the chain must end in "value".
 */
export function validateChain(
  segments: TokenSegment[],
  specs: TokenSegmentSpec[],
): ChainValidation {
  let currentType = "root";
  for (const seg of segments) {
    const spec = specs.find(
      (sp) => sp.name === seg.name && sp.inputTypes.includes(currentType),
    );
    if (!spec) {
      const anyName = specs.some((sp) => sp.name === seg.name);
      return {
        ok: false,
        error: anyName
          ? `'${seg.name}' cannot follow a ${currentType === "root" ? "chain start" : `'${currentType}'`} segment`
          : `unknown segment '${seg.name}'`,
      };
    }
    const argSpecs = spec.args || {};
    for (const key of Object.keys(seg.args)) {
      if (!argSpecs[key]) {
        return { ok: false, error: `unknown argument '${key}' on '${seg.name}'` };
      }
    }
    for (const [key, as] of Object.entries(argSpecs)) {
      if (as.required && seg.args[key] === undefined && as.default === undefined) {
        return { ok: false, error: `missing required argument '${key}' on '${seg.name}'` };
      }
    }
    currentType = spec.outputType;
  }
  if (currentType !== "value") {
    return {
      ok: false,
      error: `chain ends in '${currentType}' — add a segment that produces a value`,
    };
  }
  return { ok: true, outputType: currentType };
}

export interface TemplateTokenAnalysis {
  /** Expressions that parse and validate. */
  valid: string[];
  /** Expressions that fail to parse or validate, with the reason. */
  invalid: Array<{ expr: string; error: string }>;
}

/** Parse + validate every token in a template against the segment graph. */
export function analyzeTemplateTokens(
  template: string | null | undefined,
  specs: TokenSegmentSpec[],
): TemplateTokenAnalysis {
  const valid: string[] = [];
  const invalid: Array<{ expr: string; error: string }> = [];
  for (const expr of extractTokenExpressions(template)) {
    const parsed = parseTokenChain(expr);
    if (!parsed.ok) {
      invalid.push({ expr, error: parsed.error });
      continue;
    }
    const v = validateChain(parsed.segments, specs);
    if (!v.ok) {
      invalid.push({ expr, error: v.error });
      continue;
    }
    valid.push(expr);
  }
  return { valid, invalid };
}

// ─────────────────────────────────────────────────────────────────
// Catalog entries (picker UI)
// ─────────────────────────────────────────────────────────────────

/**
 * One insertable token the picker offers. `id` is the canonical chain
 * text (defaults omitted); `insertText` is what gets inserted into the
 * template (always `{{id}}`).
 */
export interface TokenCatalogEntry {
  id: string;
  label: string;
  description: string;
  /** Root segment name — used for grouping ("contact", "worker", …). */
  scope: string;
  insertText: string;
  defaultValue: string;
  example: string;
}

export function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

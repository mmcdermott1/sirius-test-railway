import { Fragment, useMemo, type ReactNode } from "react";
import { TOKEN_PATTERN, type TokenCatalogEntry } from "@shared/tokens";
import { htmlToInlineText, toSingleLine } from "@shared/utils/html";

/**
 * Shared read-only renderer for tokenized template text: literal text
 * stays plain, `{{token.chains}}` become compact labelled chips. Used by
 * the notifier config card's summary lines so a template reads like a
 * sentence instead of a wall of braces.
 */

/** "display_name" → "Display name"; "base_url" → "Base url". */
function humanize(raw: string): string {
  const s = raw.replace(/[_-]+/g, " ").trim();
  if (!s) return raw;
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/**
 * A short human label for one token expression: the catalog's label when
 * the chain is a catalog entry, otherwise derived from the last segment
 * (`event.field(name="status")` → "Status").
 */
export function tokenLabel(expr: string, labelById?: Map<string, string>): string {
  const trimmed = expr.trim();
  const known = labelById?.get(trimmed);
  if (known) return known;
  const segments = trimmed.split(".");
  const last = segments[segments.length - 1] ?? trimmed;
  const named = last.match(/\(\s*name\s*=\s*"([^"]*)"\s*\)/);
  if (named?.[1]) return humanize(named[1]);
  return humanize(last.replace(/\([^)]*\)$/, ""));
}

// HTML flattening and whitespace collapsing live in the shared HTML
// library (`htmlToInlineText`, `toSingleLine`) so this summary line and
// the email plain-text fallback decode entities the same way.

export interface TokenTextProps {
  text: string;
  /** Token catalog for friendly chip labels (falls back to the chain). */
  tokens?: TokenCatalogEntry[];
  /** Flatten HTML markup before rendering (for `html` template fields). */
  html?: boolean;
  className?: string;
  "data-testid"?: string;
}

export function TokenText({
  text,
  tokens,
  html,
  className,
  "data-testid": testId,
}: TokenTextProps) {
  const labelById = useMemo(
    () => new Map((tokens ?? []).map((t) => [t.id, t.label])),
    [tokens],
  );

  const source = useMemo(
    () => toSingleLine(html ? htmlToInlineText(text) : text),
    [text, html],
  );

  const parts = useMemo(() => {
    const out: ReactNode[] = [];
    let cursor = 0;
    let key = 0;
    // matchAll clones the regex, so the shared global TOKEN_PATTERN
    // keeps no lastIndex state between calls.
    for (const m of source.matchAll(TOKEN_PATTERN)) {
      const start = m.index ?? 0;
      if (start > cursor) out.push(<Fragment key={key++}>{source.slice(cursor, start)}</Fragment>);
      out.push(
        <span
          key={key++}
          className="mx-0.5 rounded bg-primary/10 px-1 py-px text-[10px] font-medium text-primary align-baseline"
          title={m[0]}
        >
          {tokenLabel(m[1], labelById)}
        </span>,
      );
      cursor = start + m[0].length;
    }
    if (cursor < source.length) out.push(<Fragment key={key++}>{source.slice(cursor)}</Fragment>);
    return out;
  }, [source, labelById]);

  return (
    <span
      className={className}
      title={source}
      data-testid={testId}
    >
      {parts}
    </span>
  );
}

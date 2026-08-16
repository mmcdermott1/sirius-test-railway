import { Fragment, useMemo, type ReactNode } from "react";
import { TOKEN_PATTERN, type TokenCatalogEntry } from "@shared/tokens";

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

/**
 * Flatten HTML to readable one-line text: block boundaries become
 * spaces, tags are dropped, the handful of entities our editors emit are
 * decoded. Token braces are untouched (they are not markup).
 */
export function htmlToPlainText(html: string): string {
  return html
    .replace(/<\s*(br|\/p|\/div|\/li|\/h[1-6]|\/tr)\s*\/?\s*>/gi, " ")
    .replace(/<[^>]*>/g, "")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&quot;/gi, '"')
    .replace(/&#39;/gi, "'");
}

/** Collapse all whitespace (incl. newlines) into single spaces. */
export function toSingleLine(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

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
    () => toSingleLine(html ? htmlToPlainText(text) : text),
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

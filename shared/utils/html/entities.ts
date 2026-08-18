/**
 * HTML entity decoding — dependency-free.
 *
 * The inverse direction of `./escape.ts`: turns `&amp;` back into `&`.
 * Used by the HTML→text conversions in `./to-text.ts`, which are the
 * only callers that should need it — decoding entities into a string
 * that is then re-inserted into HTML would undo escaping.
 *
 * No imports here either, for the same boot-path reason as `./escape.ts`.
 */

/**
 * The named entities our rich-text editor and its "Special Characters"
 * menu can emit. Intentionally small: this is a decoder for OUR content,
 * not a complete HTML5 entity table.
 *
 * Lookup is case-sensitive, matching HTML5 (`&amp;` is an entity,
 * `&AMP;` is not).
 */
export const HTML_NAMED_ENTITIES: Readonly<Record<string, string>> = {
  nbsp: " ",
  amp: "&",
  lt: "<",
  gt: ">",
  quot: '"',
  apos: "'",
  copy: "©",
  reg: "®",
  trade: "™",
  bull: "•",
  ndash: "–",
  mdash: "—",
  hellip: "…",
  sect: "§",
  para: "¶",
  deg: "°",
  ldquo: "\u201C",
  rdquo: "\u201D",
  lsquo: "\u2018",
  rsquo: "\u2019",
};

/**
 * Decode the named entities above plus decimal (`&#8212;`) and
 * hexadecimal (`&#x2014;`) numeric references. Anything unrecognized is
 * left verbatim, so unknown entities survive a round trip instead of
 * silently vanishing.
 */
export function decodeHtmlEntities(s: string): string {
  return s
    .replace(
      /&([a-zA-Z]+);/g,
      (match, name: string) => HTML_NAMED_ENTITIES[name] ?? match,
    )
    .replace(/&#(\d+);/g, (match, digits: string) => {
      const code = parseInt(digits, 10);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    })
    .replace(/&#x([0-9a-fA-F]+);/g, (match, hex: string) => {
      const code = parseInt(hex, 16);
      return Number.isFinite(code) ? String.fromCodePoint(code) : match;
    });
}

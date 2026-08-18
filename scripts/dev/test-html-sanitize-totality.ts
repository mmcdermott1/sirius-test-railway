#!/usr/bin/env tsx
/**
 * The shared HTML library on hostile input.
 *
 * These are render-path functions: `EsigView` calls
 * `sanitizeHtmlReportingChange` on a stored signed snapshot while the page
 * is rendering, and the whole point of that call is that the stored bytes
 * may be hostile. So the bar is not "returns the right string" — it is
 * "cannot throw". A function that raises on malformed input turns a
 * defended page into a blank one, which is a worse outcome than the XSS
 * it was added to prevent.
 *
 * The specific trap: `String.fromCodePoint` throws `RangeError` above
 * U+10FFFF, and `Number.isFinite` does not screen for it — so a stored
 * `&#999999999;` used to take the page down. Malformed numeric entities
 * therefore get first-class coverage below.
 *
 * Also pins the content-vs-encoding distinction that
 * `sanitizeHtmlReportingChange` exists to draw, since getting that wrong
 * silently degrades the signed-document advisory into noise.
 *
 * Run with:  npx tsx scripts/dev/test-html-sanitize-totality.ts
 *
 * Exits 0 on pass, 1 on failure.
 */
import {
  decodeHtmlEntities,
  htmlToPlainText,
  sanitizeHtml,
  sanitizeHtmlReportingChange,
} from "@shared/utils/html";

let failures = 0;

function check(name: string, cond: unknown, detail?: string): void {
  if (cond) {
    console.log(`  ok   ${name}`);
  } else {
    failures++;
    console.error(`  FAIL ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

/** Run `fn`, reporting a throw as a failure rather than crashing the run. */
function doesNotThrow(name: string, fn: () => unknown): unknown {
  try {
    const value = fn();
    console.log(`  ok   ${name}`);
    return value;
  } catch (err) {
    failures++;
    console.error(`  FAIL ${name} — threw ${String(err)}`);
    return undefined;
  }
}

console.log("\nMalformed numeric entities must not throw (render-path totality)");
{
  // Every one of these is a code point String.fromCodePoint rejects.
  const hostile = [
    "&#999999999;", // decimal, far above U+10FFFF
    "&#1114112;", // decimal, exactly one past the maximum
    "&#x110000;", // hex, one past the maximum
    "&#xFFFFFFFF;", // hex, absurd
    "&#xD800;", // lone high surrogate
    "&#xDFFF;", // lone low surrogate
    "&#55296;", // the same high surrogate in decimal
  ];

  for (const entity of hostile) {
    const html = `<p>${entity}</p>`;
    doesNotThrow(`decodeHtmlEntities(${entity})`, () => decodeHtmlEntities(html));
    doesNotThrow(`htmlToPlainText(${entity})`, () => htmlToPlainText(html));
    doesNotThrow(`sanitizeHtmlReportingChange(${entity})`, () =>
      sanitizeHtmlReportingChange(html, "signed-document"),
    );
    // Out-of-range references survive verbatim rather than vanishing.
    check(
      `${entity} left verbatim by decodeHtmlEntities`,
      decodeHtmlEntities(entity) === entity,
      `got ${JSON.stringify(decodeHtmlEntities(entity))}`,
    );
  }
}

console.log("\nValid entities still decode");
{
  check("&#10003; → ✓", decodeHtmlEntities("&#10003;") === "✓");
  check("&#x2713; → ✓", decodeHtmlEntities("&#x2713;") === "✓");
  check("&amp; → &", decodeHtmlEntities("&amp;") === "&");
  check("&#x10FFFF; (the maximum) decodes", decodeHtmlEntities("&#x10FFFF;") !== "&#x10FFFF;");
  check("&#0; decodes", decodeHtmlEntities("&#0;") === "\u0000");
  check("unknown name left verbatim", decodeHtmlEntities("&nope;") === "&nope;");
}

console.log("\nEncoding-only change is NOT reported as a content change");
{
  // DOMPurify re-serializes the DOM it parsed, so a stored `&#10003;` comes
  // back as a literal `✓`. Same glyph; must not fire the advisory.
  const stored = '<span style="color: green;">&#10003;</span>';
  const { clean, contentChanged } = sanitizeHtmlReportingChange(stored, "signed-document");
  check("bytes did change (DOMPurify re-serialized)", clean !== stored);
  check("but contentChanged is false", contentChanged === false, `clean=${clean}`);
}

console.log("\nA real strip IS reported as a content change");
{
  for (const [label, stored] of [
    ["script tag", "<p>hi</p><script>alert(1)</script>"],
    ["event handler", '<div onclick="alert(1)">hi</div>'],
    ["javascript: href", '<a href="javascript:alert(1)">click</a>'],
    ["iframe", '<iframe src="//evil"></iframe><p>after</p>'],
  ] as const) {
    const { contentChanged } = sanitizeHtmlReportingChange(stored, "signed-document");
    check(`${label} reported`, contentChanged === true);
  }
}

console.log("\nUnchanged content reports no change at all");
{
  const stored = "I hereby <b>waive all liability</b> for any damage.";
  const { clean, contentChanged } = sanitizeHtmlReportingChange(stored, "authored-document");
  check("clean is byte-identical", clean === stored, `got ${JSON.stringify(clean)}`);
  check("contentChanged is false", contentChanged === false);
}

console.log("\nThe signed-document policy keeps the markup signing pages generate");
{
  // The blocks cardcheck-view appends around a definition body.
  const generated =
    '<div style="margin-top: 16px; border-top: 1px solid #ddd;">' +
    '<p style="font-weight: 600;">Acknowledged Statements:</p>' +
    '<span style="color: green; font-weight: bold;">&#10003;</span> <span>I like apples</span>' +
    "</div>";
  const clean = sanitizeHtml(generated, "signed-document");
  check("div survives", clean.includes("<div"));
  check("span survives", clean.includes("<span"));
  check("inline style survives", clean.includes("border-top"));
  check(
    "no content lost",
    sanitizeHtmlReportingChange(generated, "signed-document").contentChanged === false,
  );
}

console.log(
  failures === 0
    ? "\n[test-html-sanitize-totality] OK — all assertions passed.\n"
    : `\n[test-html-sanitize-totality] FAILED — ${failures} assertion(s).\n`,
);
process.exit(failures === 0 ? 0 : 1);

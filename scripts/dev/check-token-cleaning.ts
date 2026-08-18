#!/usr/bin/env tsx
/**
 * Check Token Cleaning Declarations
 *
 * Evaluating a token is a string operation that knows nothing about
 * where the string is going. Whatever neutralizing a value needs is the
 * DESTINATION's business, so every tokenized field declares a cleaning
 * function — value in, cleaned value out — that both the preview route
 * and the delivery paths call. A field that resolves no cleaner would
 * insert raw values into a container whose rules nobody stated.
 *
 * This asserts two things about the shared delivery tables, at author
 * time:
 *
 *   1. Every tokenized field resolves a cleaning function, and every
 *      field that is NOT tokenized resolves none (nothing is inserted
 *      into it, so it must never be evaluated).
 *
 *   2. An HTML destination ESCAPES; it does not allow-list. Escaped
 *      text is safe wherever it lands in an HTML document — including
 *      inside a link address, and shipped templates do build hrefs out
 *      of tokens — whereas an allow-list decision depends on where in
 *      the document the value sits, which a per-value cleaner cannot
 *      know and must not try to guess. Sanitizing the FINISHED string
 *      is a separate step (`shapeRenderedValue`) and stays there.
 *
 * The probes below are checked against `escapeHtml` itself, so an HTML
 * cleaner that starts stripping, rewriting or allow-listing markup
 * fails here rather than in someone's inbox.
 *
 * Run with:  npx tsx scripts/dev/check-token-cleaning.ts
 */
import {
  BULK_CHANNEL_FIELDS,
  NOTIFIER_CHANNEL_FIELDS,
  tokenCleanerFor,
  type CleanedToken,
  type DeliveryFieldSpec,
} from "../../shared/delivery-fields";
import { escapeHtml } from "../../shared/utils/html/escape";

const TABLES: { name: string; table: Record<string, DeliveryFieldSpec[]> }[] = [
  { name: "BULK_CHANNEL_FIELDS", table: BULK_CHANNEL_FIELDS },
  { name: "NOTIFIER_CHANNEL_FIELDS", table: NOTIFIER_CHANNEL_FIELDS },
];

/** An ordinary token: a recorded value, not markup. */
const PLAIN_TOKEN: CleanedToken = { id: "worker.name", emitsHtml: false };
/** A token that declares its value is already markup. */
const HTML_TOKEN: CleanedToken = { id: "trusted.block", emitsHtml: true };

/**
 * Values a real token can produce. Nothing here is exotic: names carry
 * ampersands and angle brackets, and tokens get dropped into hrefs.
 */
const PROBES = [
  "Sam > Nelson",
  "Baker & Sons",
  "<b>bold</b>",
  `He said "hi" — it's fine`,
  "javascript:alert(1)",
  "/dispatch/job/42?a=1&b=2",
  "",
];

const failures: string[] = [];

function fail(label: string, problem: string) {
  failures.push(`${label}: ${problem}`);
}

function checkHtmlCleaner(label: string, spec: DeliveryFieldSpec) {
  const clean = tokenCleanerFor(spec)!;
  for (const probe of PROBES) {
    const got = clean(probe, PLAIN_TOKEN);
    const want = escapeHtml(probe);
    if (got !== want) {
      fail(
        label,
        `HTML field must escape token values, not inspect them — ` +
          `cleaning ${JSON.stringify(probe)} gave ${JSON.stringify(got)}, ` +
          `expected ${JSON.stringify(want)}`,
      );
    }
  }
  // `emitsHtml` is information the container consults, not an override
  // the token asserts — but the HTML container does honour it today, so
  // a change of mind has to be made here, deliberately.
  const trusted = clean("<b>bold</b>", HTML_TOKEN);
  if (trusted !== "<b>bold</b>") {
    fail(
      label,
      `a token declaring emitsHtml should pass through this HTML field ` +
        `verbatim, got ${JSON.stringify(trusted)}`,
    );
  }
}

function checkTextCleaner(label: string, spec: DeliveryFieldSpec) {
  const clean = tokenCleanerFor(spec)!;
  for (const probe of PROBES) {
    const got = clean(probe, PLAIN_TOKEN);
    if (got !== probe) {
      fail(
        label,
        `plain-text field must insert token values verbatim — ` +
          `cleaning ${JSON.stringify(probe)} gave ${JSON.stringify(got)}`,
      );
    }
  }
}

function main() {
  let tokenized = 0;
  let verbatim = 0;

  for (const { name, table } of TABLES) {
    for (const [channel, fields] of Object.entries(table)) {
      for (const spec of fields) {
        const label = `${name}.${channel}.${spec.key}`;
        const clean = tokenCleanerFor(spec);

        if (spec.tokenized === false) {
          verbatim++;
          if (clean !== null) {
            fail(
              label,
              "field is not tokenized, so it must resolve no cleaning " +
                "function — nothing is ever inserted into it",
            );
          }
          continue;
        }

        tokenized++;
        if (typeof clean !== "function") {
          fail(label, `tokenized field declares no cleaning function`);
          continue;
        }
        if (clean.length > 2) {
          fail(
            label,
            "a cleaning function takes the value and the token that " +
              "produced it, and nothing about the surrounding template",
          );
        }
        if (spec.syntax === "html") checkHtmlCleaner(label, spec);
        else checkTextCleaner(label, spec);
      }
    }
  }

  console.log(
    `  ${tokenized} tokenized field(s) with a cleaning function, ` +
      `${verbatim} sent verbatim`,
  );
  console.log("");

  if (failures.length === 0) {
    console.log("PASS: every tokenized field's destination declares how it cleans");
    process.exit(0);
  }
  console.error(`FAIL: ${failures.length} problem(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

main();

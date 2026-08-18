#!/usr/bin/env tsx
/**
 * Check Delivery Field Declarations
 *
 * Every tokenized field previews through ONE route
 * (POST /api/template-studio/preview), which shapes each rendered field
 * according to what the request declares about it: the syntax it is
 * written in (plain text or HTML), the safety rule its finished value
 * must satisfy, and whether it is tokenized at all.
 *
 * A field with no declared syntax has no defined shaping, which means
 * its preview and its delivered output can silently disagree. The
 * editors don't hand-write those declarations: they import the shared
 * field-shaping tables in `shared/delivery-fields.ts`, the same ones
 * the server's delivery paths shape with. So the tables are where the
 * agreement actually lives, and this check asserts, at author time,
 * that each one is structurally sound — every field declares a known
 * syntax (and a known safety rule, if any), keys are unique, and
 * `blankWithout` points at a field that exists in the same table.
 *
 * What each destination MEANS by cleaning a token's value is checked
 * separately, by check-token-cleaning.ts.
 *
 * (The preview route runs the very same validation over the specs a
 * caller posts, so a malformed declaration is rejected at request time
 * too. This check is the earlier of the two warnings.)
 *
 * Run with:  npx tsx scripts/dev/check-delivery-fields.ts
 */
import {
  BULK_CHANNEL_FIELDS,
  NOTIFIER_CHANNEL_FIELDS,
  validateDeliveryFieldSpecs,
  type DeliveryFieldSpec,
} from "../../shared/delivery-fields";

const TABLES: { name: string; table: Record<string, DeliveryFieldSpec[]> }[] = [
  { name: "BULK_CHANNEL_FIELDS", table: BULK_CHANNEL_FIELDS },
  { name: "NOTIFIER_CHANNEL_FIELDS", table: NOTIFIER_CHANNEL_FIELDS },
];

function main() {
  const failures: string[] = [];
  let channels = 0;

  for (const { name, table } of TABLES) {
    const entries = Object.entries(table);
    if (entries.length === 0) {
      failures.push(`${name} declares no channels at all`);
      continue;
    }
    for (const [channel, fields] of entries) {
      channels++;
      for (const problem of validateDeliveryFieldSpecs(fields)) {
        failures.push(`${name}.${channel}: ${problem}`);
      }
      const summary = (Array.isArray(fields) ? fields : [])
        .map(
          (f) =>
            `${f.key}:${f.syntax}` +
            (f.safety ? `+${f.safety}` : "") +
            (f.tokenized === false ? " (verbatim)" : ""),
        )
        .join(", ");
      console.log(`  ${name}.${channel} — ${summary}`);
    }
  }

  console.log("");
  if (failures.length === 0) {
    console.log(
      `PASS: ${channels} delivery channel(s), every field declares a syntax`,
    );
    process.exit(0);
  }

  console.error(`FAIL: ${failures.length} problem(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

main();

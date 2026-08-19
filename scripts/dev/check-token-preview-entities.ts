#!/usr/bin/env tsx
/**
 * Check Token Preview Entity Declarations
 *
 * Previewing a template against a REAL record is a read of that record.
 * The studio context therefore only offers kinds whose owning token
 * plugin says how such a read is authorized — the `previewEntity`
 * declaration — and it runs that declaration over every record it
 * offers and every record it loads.
 *
 * The whole design rests on the declaration being TRUE, and nothing at
 * runtime can tell a wrong policy id from a right one: an unknown
 * policy simply denies, which looks like a permissions problem rather
 * than a bug. So it is checked here, at author time:
 *
 *  - a previewable kind declares a gate at all (silence means "not
 *    previewable", never "open");
 *  - the policy it names actually exists;
 *  - a `record` gate names an ENTITY-scoped policy (one that can be
 *    asked about a specific record) and a `route` gate names a
 *    ROUTE-scoped one (a broad page gate with no id) — a mismatch would
 *    quietly authorize the wrong thing;
 *  - the kind can both offer records and load one by id, since the
 *    studio needs both halves and a missing one only shows up as an
 *    empty dropdown.
 *
 * Run with:  npx tsx scripts/dev/check-token-preview-entities.ts
 */
// The event-notifier barrel first: importing the tokens barrel ahead of
// it initializes the shared plugin registry mid-cycle and crashes.
import { initializeEventNotifierPluginSystem } from "../../server/plugins/event-notifier";
import { initializeTokenPluginSystem } from "../../server/plugins/tokens";
import { describeTokenPreviewEntities } from "../../server/plugins/tokens/preview-entities";
import "../../shared/access-policies/loader";
import { getPolicy } from "../../shared/access-policies";

let failures = 0;

function fail(message: string): void {
  failures++;
  console.log(`FAIL ${message}`);
}

function main(): void {
  initializeEventNotifierPluginSystem();
  initializeTokenPluginSystem();

  const declared = describeTokenPreviewEntities();
  if (declared.length === 0) {
    fail(
      "No token entity kind declares a preview gate — the studio would " +
        "offer nothing at all.",
    );
  }

  for (const entry of declared) {
    const where = `kind "${entry.kind}" (${entry.pluginId})`;

    if (!entry.gate || typeof entry.gate.policy !== "string" || !entry.gate.policy) {
      fail(`${where} is previewable but declares no gate policy.`);
      continue;
    }
    if (entry.gate.scope !== "record" && entry.gate.scope !== "route") {
      fail(`${where} declares an unknown gate scope "${(entry.gate as any).scope}".`);
      continue;
    }

    const policy = getPolicy(entry.gate.policy);
    if (!policy) {
      fail(
        `${where} names the policy "${entry.gate.policy}", which is not ` +
          `registered — an unknown policy denies silently.`,
      );
      continue;
    }
    if (entry.gate.scope === "record" && policy.scope !== "entity") {
      fail(
        `${where} declares a record-scoped gate on "${entry.gate.policy}", ` +
          `but that policy is ${policy.scope}-scoped — it cannot be asked ` +
          `about one record.`,
      );
    }
    if (entry.gate.scope === "route" && policy.scope !== "route") {
      fail(
        `${where} declares a route-scoped gate on "${entry.gate.policy}", ` +
          `but that policy is ${policy.scope}-scoped — declare it as a ` +
          `record gate so it is asked per record.`,
      );
    }

    if (!entry.hasOffer) fail(`${where} declares no offer for the studio.`);
    if (!entry.hasLoad) fail(`${where} declares no load-by-id.`);

    if (failures === 0) {
      console.log(
        `PASS ${entry.kind}: ${entry.gate.scope} gate "${entry.gate.policy}"` +
          (entry.requiredComponent ? ` + component ${entry.requiredComponent}` : ""),
      );
    }
  }

  console.log(
    failures === 0
      ? `\nPASS: ${declared.length} previewable token entity kind(s), each declaring how a read is gated`
      : `\nFAIL: ${failures} preview gating problem(s)`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main();

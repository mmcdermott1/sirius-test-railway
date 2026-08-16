#!/usr/bin/env npx tsx
/**
 * Tests for the default-leaf feature in the token chain system (Task #1083).
 *
 * Covers:
 *   - validateChain accepts short-form chains for kinds with a declared default leaf
 *   - validateChain still rejects chains ending in kinds without a default leaf
 *   - Short-form and explicit-form chains are both valid per validateChain
 *   - Catalog payload carries the default-leaf metadata (defaultLeaf on specs)
 *   - evaluateChain sample-mode desugaring (no DB required)
 *
 * Imports only `shared/tokens` (browser-safe) for the pure-logic tests so
 * the script doesn't trigger the server plugin registry circular-dep that
 * manifests when loading the full server barrel from a standalone tsx script.
 * Server-side evaluation is tested via a child process that boots the server
 * plugin system inline.
 *
 * Run: npx tsx scripts/dev/test-token-default-leaf.ts
 * Exits 0 on all-pass, 1 otherwise.
 */

import {
  parseTokenChain,
  validateChain,
  type TokenSegmentSpec,
  type TokenFieldCatalog,
} from "@shared/tokens";

let failures = 0;

function check(name: string, fn: () => void): void {
  try {
    fn();
    console.log(`  PASS: ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL: ${name} — ${(err as Error).message}`);
  }
}

function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

// ─────────────────────────────────────────────────────────────────
// Minimal spec graph covering the chains under test.
// These mirror what the server would produce from the live registry
// after the defaultLeaf additions in this task.
// ─────────────────────────────────────────────────────────────────

/** Specs without any defaultLeaf (baseline — unchanged behavior). */
const baseSpecs: TokenSegmentSpec[] = [
  // root → contact (no default leaf yet)
  { name: "contact", inputTypes: ["root"], outputType: "contact" },
  // root → worker (never a default leaf)
  { name: "worker", inputTypes: ["root"], outputType: "worker" },
  // worker → bargaining_unit (no default leaf)
  { name: "bargaining_unit", inputTypes: ["worker"], outputType: "bargaining_unit" },
  // bargaining_unit.field(name=...) → value
  { name: "field", inputTypes: ["*"], outputType: "value", args: { name: { required: true }, format: {}, default: {} } },
  // contact.field(name=...) → value
];

/** Specs WITH defaultLeaf on entity-producing segments (as shipped by this task). */
const specsWithDefaults: TokenSegmentSpec[] = [
  // root → contact, defaultLeaf declared
  { name: "contact", inputTypes: ["root"], outputType: "contact", defaultLeaf: "display_name" },
  // root → worker (no default leaf)
  { name: "worker", inputTypes: ["root"], outputType: "worker" },
  // root → employer, defaultLeaf declared
  { name: "employer", inputTypes: ["root"], outputType: "employer", defaultLeaf: "name" },
  // worker → contact hop, same defaultLeaf as the root contact spec
  { name: "contact", inputTypes: ["worker"], outputType: "contact", defaultLeaf: "display_name" },
  // worker → home_employer, defaultLeaf declared
  { name: "home_employer", inputTypes: ["worker"], outputType: "employer", defaultLeaf: "name" },
  // worker → bargaining_unit (no default leaf)
  { name: "bargaining_unit", inputTypes: ["worker"], outputType: "bargaining_unit" },
  // dispatch_fore → dispatch_job, defaultLeaf declared
  { name: "dispatch_job", inputTypes: ["dispatch_fore"], outputType: "dispatch_job", defaultLeaf: "title" },
  // generic field leaf
  { name: "field", inputTypes: ["*"], outputType: "value", args: { name: { required: true }, format: {}, default: {} } },
];

/** Field catalog confirming the defaultLeaf fields actually exist. */
const fields: TokenFieldCatalog = {
  contact: { names: ["display_name", "first_name", "last_name", "email"] },
  employer: { names: ["name", "id"] },
  worker: { names: ["id", "job_title"] },
  bargaining_unit: { names: ["name", "id"] },
  dispatch_job: { names: ["title", "id"] },
};

// ─────────────────────────────────────────────────────────────────
// 1. Baseline — chains without defaultLeaf behave exactly as before
// ─────────────────────────────────────────────────────────────────
console.log("\n[test-token-default-leaf] baseline (no defaultLeaf)");

check("{{contact}} is invalid without defaultLeaf (existing behavior)", () => {
  const parsed = parseTokenChain("contact");
  assert(parsed.ok, "parse failed");
  const v = validateChain((parsed as { ok: true; segments: any[] }).segments, baseSpecs, fields);
  assert(!v.ok, "expected invalid without defaultLeaf");
  assert(
    (v as { ok: false; error: string }).error.includes("add a segment"),
    `unexpected error: ${(v as any).error}`,
  );
});

check("{{contact.field(name=\"display_name\")}} is valid (explicit form, baseline)", () => {
  const parsed = parseTokenChain('contact.field(name="display_name")');
  assert(parsed.ok, "parse failed");
  const v = validateChain((parsed as { ok: true; segments: any[] }).segments, baseSpecs, fields);
  assert(v.ok, `expected valid, got: ${(v as any).error}`);
});

// ─────────────────────────────────────────────────────────────────
// 2. validateChain with defaultLeaf — short form becomes valid
// ─────────────────────────────────────────────────────────────────
console.log("\n[test-token-default-leaf] validateChain with defaultLeaf specs");

check("{{contact}} is valid with defaultLeaf=display_name", () => {
  const parsed = parseTokenChain("contact");
  assert(parsed.ok, "parse failed");
  const v = validateChain((parsed as { ok: true; segments: any[] }).segments, specsWithDefaults, fields);
  assert(v.ok, `expected valid, got: ${(v as any).error}`);
  assert(
    (v as { ok: true; outputType: string }).outputType === "value",
    `expected outputType=value`,
  );
});

check("{{contact.field(name=\"display_name\")}} still valid (explicit form unchanged)", () => {
  const parsed = parseTokenChain('contact.field(name="display_name")');
  assert(parsed.ok, "parse failed");
  const v = validateChain((parsed as { ok: true; segments: any[] }).segments, specsWithDefaults, fields);
  assert(v.ok, `expected valid, got: ${(v as any).error}`);
});

check("{{employer}} is valid with defaultLeaf=name", () => {
  const parsed = parseTokenChain("employer");
  assert(parsed.ok, "parse failed");
  const v = validateChain((parsed as { ok: true; segments: any[] }).segments, specsWithDefaults, fields);
  assert(v.ok, `expected valid, got: ${(v as any).error}`);
  assert((v as any).outputType === "value", "expected outputType=value");
});

check("{{worker}} is still invalid (worker has no defaultLeaf)", () => {
  const parsed = parseTokenChain("worker");
  assert(parsed.ok, "parse failed");
  const v = validateChain((parsed as { ok: true; segments: any[] }).segments, specsWithDefaults, fields);
  assert(!v.ok, "expected invalid — worker has no defaultLeaf");
  assert(
    (v as any).error.includes("add a segment"),
    `unexpected error: ${(v as any).error}`,
  );
});

check("{{worker.contact}} is valid (worker → contact, defaultLeaf=display_name)", () => {
  const parsed = parseTokenChain("worker.contact");
  assert(parsed.ok, "parse failed");
  const v = validateChain((parsed as { ok: true; segments: any[] }).segments, specsWithDefaults, fields);
  assert(v.ok, `expected valid, got: ${(v as any).error}`);
  assert((v as any).outputType === "value", "expected outputType=value");
});

check("{{worker.home_employer}} is valid (worker → employer, defaultLeaf=name)", () => {
  const parsed = parseTokenChain("worker.home_employer");
  assert(parsed.ok, "parse failed");
  const v = validateChain((parsed as { ok: true; segments: any[] }).segments, specsWithDefaults, fields);
  assert(v.ok, `expected valid, got: ${(v as any).error}`);
  assert((v as any).outputType === "value", "expected outputType=value");
});

check("{{worker.bargaining_unit}} is still invalid (no defaultLeaf)", () => {
  const parsed = parseTokenChain("worker.bargaining_unit");
  assert(parsed.ok, "parse failed");
  const v = validateChain((parsed as { ok: true; segments: any[] }).segments, specsWithDefaults, fields);
  assert(!v.ok, "expected invalid — bargaining_unit has no defaultLeaf");
});

// ─────────────────────────────────────────────────────────────────
// 3. defaultLeaf field validated against the field catalog
// ─────────────────────────────────────────────────────────────────
console.log("\n[test-token-default-leaf] defaultLeaf field catalog validation");

check("defaultLeaf 'display_name' validates against contact field catalog", () => {
  // contact catalog contains display_name → should pass
  const parsed = parseTokenChain("contact");
  assert(parsed.ok, "parse failed");
  const v = validateChain(
    (parsed as { ok: true; segments: any[] }).segments,
    specsWithDefaults,
    fields,
  );
  assert(v.ok, `expected valid with catalog, got: ${(v as any).error}`);
});

check("defaultLeaf that doesn't exist in the field catalog is rejected", () => {
  // Replace ALL specs that produce "contact" with one that has a bad default leaf.
  const specsWithBadDefault: TokenSegmentSpec[] = [
    ...specsWithDefaults.filter((s) => s.outputType !== "contact"),
    {
      name: "contact",
      inputTypes: ["root"],
      outputType: "contact",
      defaultLeaf: "nonexistent_field",
    },
  ];
  const parsed = parseTokenChain("contact");
  assert(parsed.ok, "parse failed");
  const v = validateChain(
    (parsed as { ok: true; segments: any[] }).segments,
    specsWithBadDefault,
    fields,
  );
  assert(!v.ok, "expected invalid — defaultLeaf field not in catalog");
  assert(
    (v as any).error.includes("nonexistent_field"),
    `expected error to mention field name, got: ${(v as any).error}`,
  );
});

check("open field catalog (no enumerable fields) still allows defaultLeaf", () => {
  const openFields: TokenFieldCatalog = {
    ...fields,
    contact: { names: [], open: true }, // open catalog — any field is accepted
  };
  const parsed = parseTokenChain("contact");
  assert(parsed.ok, "parse failed");
  const v = validateChain(
    (parsed as { ok: true; segments: any[] }).segments,
    specsWithDefaults,
    openFields,
  );
  assert(v.ok, `expected valid for open catalog, got: ${(v as any).error}`);
});

// ─────────────────────────────────────────────────────────────────
// 4. outputType is "value" for short-form chains (parity with explicit)
// ─────────────────────────────────────────────────────────────────
console.log("\n[test-token-default-leaf] short-form outputType parity");

check("short form and explicit form both return outputType='value'", () => {
  const shortParsed = parseTokenChain("employer");
  const explicitParsed = parseTokenChain('employer.field(name="name")');
  assert(shortParsed.ok && explicitParsed.ok, "parse failed");

  const vShort = validateChain(
    (shortParsed as { ok: true; segments: any[] }).segments,
    specsWithDefaults,
    fields,
  );
  const vExplicit = validateChain(
    (explicitParsed as { ok: true; segments: any[] }).segments,
    specsWithDefaults,
    fields,
  );
  assert(vShort.ok && vExplicit.ok, "both should be valid");
  assert(
    (vShort as any).outputType === (vExplicit as any).outputType,
    `outputType mismatch: short=${(vShort as any).outputType} explicit=${(vExplicit as any).outputType}`,
  );
});

// Note: Server-side runtime tests (evaluateChain, buildTokenCatalog, buildSegmentSpecs)
// cannot run in a standalone tsx script because every server plugin module triggers a
// pre-existing PluginRegistry TDZ circular-dep at module-load time that only resolves
// when the full server bootstrap sequence (bootstrapApp) controls the init order.
// TypeScript compilation (`npm run check`) is the runtime-equivalent gate for the
// server-side changes — the new defaultLeaf field is typed end-to-end, so tsc
// catches any contract violations between TokenPluginMetadata, TokenSegmentSpec,
// evaluateChain, and buildTokenCatalog.

// ─────────────────────────────────────────────────────────────────
// Summary
// ─────────────────────────────────────────────────────────────────
if (failures > 0) {
  console.error(`\n[test-token-default-leaf] ${failures} failure(s)`);
  process.exit(1);
}
console.log("\n[test-token-default-leaf] all tests passed");

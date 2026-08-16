#!/usr/bin/env npx tsx
/**
 * Regression tests for per-variable environment-override rows (ENV_{NAME}
 * variables rows) and their cache invalidation, including the generic
 * variable-route rename/delete paths.
 *
 * Run: npx tsx scripts/dev/test-env-override-rows.ts
 * Exits 0 when all assertions pass, 1 otherwise. Needs the dev database.
 */
import { storage } from "../../server/storage";
import {
  envOverrideVariableName,
  getEnvOverrideMap,
  initEnvOverrides,
  refreshEnvOverrides,
} from "../../server/services/env-overrides";
import {
  getEnvironmentVariable,
  isEnvironmentVariableOverridable,
  registerEnvironmentVariables,
} from "../../server/config/env-registry";
import {
  runVariableOnWrite,
  validateVariableValue,
  redactVariableForRead,
} from "../../server/modules/system/variable-registry";

let failures = 0;
function check(name: string, cond: unknown, msg?: string): void {
  if (cond) {
    console.log(`  PASS: ${name}`);
  } else {
    failures++;
    console.error(`  FAIL: ${name}${msg ? ` — ${msg}` : ""}`);
  }
}

const TEST_ENV = "TEST_ENV_OVERRIDE_ROWS_VAR";
const ROW = envOverrideVariableName(TEST_ENV);
const RENAMED = "renamed_out_of_env_namespace_test";

async function cleanup() {
  for (const n of [ROW, RENAMED]) {
    const row = await storage.variables.getByName(n);
    if (row) await storage.variables.delete(row.id);
  }
  await refreshEnvOverrides();
}

async function main() {
  registerEnvironmentVariables([
    { name: TEST_ENV, description: "test", secret: false, category: "core" },
  ]);
  await cleanup();
  await initEnvOverrides();

  // Overridability: registered names only, no denylist.
  check("registered var overridable", isEnvironmentVariableOverridable(TEST_ENV));
  check("SESSION_SECRET overridable (owner decision)", isEnvironmentVariableOverridable("SESSION_SECRET"));
  check("unregistered not overridable", !isEnvironmentVariableOverridable("NOT_A_REAL_VAR_XYZ"));

  // Validation of ENV_* rows: string only, no empty, no sentinel.
  check("ENV_* accepts string", validateVariableValue(ROW, "x").ok);
  check("ENV_* rejects empty", !validateVariableValue(ROW, "").ok);
  check("ENV_* rejects sentinel", !validateVariableValue(ROW, "__UNSET__").ok);
  check("ENV_* rejects object", !validateVariableValue(ROW, { a: 1 }).ok);

  // Create ENV_ row + hook → cache picks it up, getter falls back to it.
  const created = await storage.variables.create({ name: ROW, value: "row-value" });
  await runVariableOnWrite(ROW);
  check("cache has override after create+hook", getEnvOverrideMap().get(TEST_ENV) === "row-value");
  delete process.env[TEST_ENV];
  check("getter serves override when env absent", getEnvironmentVariable(TEST_ENV) === "row-value");
  process.env[TEST_ENV] = "real-env";
  check("real env wins", getEnvironmentVariable(TEST_ENV) === "real-env");
  process.env[TEST_ENV] = "__UNSET__";
  check("__UNSET__ releases to override", getEnvironmentVariable(TEST_ENV) === "row-value");
  delete process.env[TEST_ENV];

  // Redaction: non-secret env var's override value is readable; unknown redacted.
  const redacted = redactVariableForRead({ name: ROW, value: "row-value" });
  check("non-secret ENV_* not redacted", redacted.value === "row-value");
  const redactedUnknown = redactVariableForRead({ name: "ENV_TOTALLY_UNKNOWN", value: "v" });
  check("unknown ENV_* redacted defensively", redactedUnknown.value === "[redacted]");

  // Rename OUT of the ENV_ namespace via the generic update path: the
  // route runs hooks for BOTH names; simulate exactly that.
  await storage.variables.update(created.id, { name: RENAMED });
  for (const hookName of Array.from(new Set([ROW, RENAMED]))) {
    await runVariableOnWrite(hookName);
  }
  check("override gone after rename out of namespace", getEnvOverrideMap().get(TEST_ENV) === undefined);
  check("getter no longer serves override", getEnvironmentVariable(TEST_ENV) === undefined);

  // Rename BACK into the namespace: hook for new name restores it.
  await storage.variables.update(created.id, { name: ROW });
  for (const hookName of Array.from(new Set([RENAMED, ROW]))) {
    await runVariableOnWrite(hookName);
  }
  check("override restored after rename back", getEnvOverrideMap().get(TEST_ENV) === "row-value");

  // Delete via generic path (delete + hook for the row name).
  await storage.variables.delete(created.id);
  await runVariableOnWrite(ROW);
  check("override gone after delete+hook", getEnvOverrideMap().get(TEST_ENV) === undefined);

  await cleanup();
  console.log(failures === 0 ? "\nAll env-override-row tests passed." : `\n${failures} failure(s).`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

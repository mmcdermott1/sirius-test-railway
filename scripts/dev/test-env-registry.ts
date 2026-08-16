#!/usr/bin/env npx tsx
/**
 * Tests for the environment-variable registry (Task #1053) and its
 * author-time enforcement script.
 *
 * Run: npx tsx scripts/dev/test-env-registry.ts
 * Exits 0 when all assertions pass, 1 otherwise.
 */
import { execSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  registerEnvironmentVariable,
  registerEnvironmentVariables,
  isEnvironmentVariableRegistered,
  getEnvironmentVariable,
  setEnvironmentVariable,
  setEnvironmentVariableOverride,
  listEnvironmentVariables,
  listPresentEnvironmentVariableNames,
  getRawProcessEnv,
} from "../../server/config/env-registry";
import { getPublicBaseUrl } from "../../server/services/comm/callback-handlers/url-builder";

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
function assertThrows(fn: () => void, match: string): void {
  try {
    fn();
  } catch (err) {
    assert(
      (err as Error).message.includes(match),
      `expected error containing "${match}", got "${(err as Error).message}"`,
    );
    return;
  }
  throw new Error(`expected an error containing "${match}", none thrown`);
}

console.log("[test-env-registry] registry behavior");

check("core variables are registered at module load", () => {
  assert(isEnvironmentVariableRegistered("DATABASE_URL"), "DATABASE_URL missing");
  assert(isEnvironmentVariableRegistered("NODE_ENV"), "NODE_ENV missing");
  assert(isEnvironmentVariableRegistered("PUBLIC_URL"), "PUBLIC_URL missing");
});

check("PUBLIC_URL resolution order: explicit value wins, normalized", () => {
  const saved = {
    PUBLIC_URL: process.env.PUBLIC_URL,
    REPLIT_DEV_DOMAIN: process.env.REPLIT_DEV_DOMAIN,
    REPLIT_DEPLOYMENT_DOMAIN: process.env.REPLIT_DEPLOYMENT_DOMAIN,
    REPLIT_DOMAINS: process.env.REPLIT_DOMAINS,
  };
  try {
    process.env.PUBLIC_URL = "https://fls.example.com/";
    process.env.REPLIT_DEV_DOMAIN = "dev.replit.example";
    assert(
      getEnvironmentVariable("PUBLIC_URL") === "https://fls.example.com",
      `explicit value should win and lose trailing slash, got ${getEnvironmentVariable("PUBLIC_URL")}`,
    );

    process.env.PUBLIC_URL = "fls.example.com";
    assert(
      getEnvironmentVariable("PUBLIC_URL") === "https://fls.example.com",
      "bare host should gain https scheme",
    );

    delete process.env.PUBLIC_URL;
    assert(
      getEnvironmentVariable("PUBLIC_URL") === "https://dev.replit.example",
      "should fall back to REPLIT_DEV_DOMAIN",
    );

    delete process.env.REPLIT_DEV_DOMAIN;
    process.env.REPLIT_DEPLOYMENT_DOMAIN = "prod.replit.example";
    assert(
      getEnvironmentVariable("PUBLIC_URL") === "https://prod.replit.example",
      "should fall back to REPLIT_DEPLOYMENT_DOMAIN",
    );

    delete process.env.REPLIT_DEPLOYMENT_DOMAIN;
    process.env.REPLIT_DOMAINS = "a.replit.example,b.replit.example";
    assert(
      getEnvironmentVariable("PUBLIC_URL") === "https://a.replit.example",
      "should fall back to first of REPLIT_DOMAINS",
    );

    delete process.env.REPLIT_DOMAINS;
    assert(
      getEnvironmentVariable("PUBLIC_URL") === "https://localhost:5000",
      "should fall back to localhost last resort",
    );

    process.env.PUBLIC_URL = "http://fls.example.com";
    assert(
      getEnvironmentVariable("PUBLIC_URL") === "https://fls.example.com",
      "http on a non-localhost host should be upgraded to https",
    );

    process.env.PUBLIC_URL = "http://localhost:3000";
    assert(
      getEnvironmentVariable("PUBLIC_URL") === "http://localhost:3000",
      "http should be preserved for localhost",
    );

    process.env.PUBLIC_URL = "https://fls.example.com/some/path?q=1#frag";
    assert(
      getEnvironmentVariable("PUBLIC_URL") === "https://fls.example.com",
      "path, query, and fragment should be stripped to the origin",
    );

    process.env.PUBLIC_URL = "https://";
    assertThrows(
      () => getEnvironmentVariable("PUBLIC_URL"),
      "cannot be parsed",
    );

    delete process.env.PUBLIC_URL;
    process.env.REPLIT_DEV_DOMAIN = "  dev.replit.example  ";
    assert(
      getEnvironmentVariable("PUBLIC_URL") === "https://dev.replit.example",
      "platform domain should be trimmed",
    );
    delete process.env.REPLIT_DEV_DOMAIN;

    // External-callback builder must refuse the localhost fallback.
    assert(
      getPublicBaseUrl() === undefined,
      "getPublicBaseUrl should be undefined on the localhost fallback",
    );
    process.env.PUBLIC_URL = "https://fls.example.com";
    assert(
      getPublicBaseUrl() === "https://fls.example.com",
      "getPublicBaseUrl should return the resolved public URL",
    );
  } finally {
    for (const [k, v] of Object.entries(saved)) {
      if (v === undefined) delete process.env[k];
      else process.env[k] = v;
    }
  }
});

check("reading an unregistered variable fails loudly", () => {
  assertThrows(() => getEnvironmentVariable("TOTALLY_UNDECLARED_VAR_42"), "not registered");
});

check("registration + read round-trip", () => {
  registerEnvironmentVariable({
    name: "TEST_ENVREG_PLAIN",
    description: "test variable",
    secret: false,
    category: "core",
  });
  setEnvironmentVariable("TEST_ENVREG_PLAIN", "hello");
  assert(getEnvironmentVariable("TEST_ENVREG_PLAIN") === "hello", "value mismatch");
});

check("setEnvironmentVariable rejects unregistered names", () => {
  assertThrows(() => setEnvironmentVariable("TEST_ENVREG_UNREG", "x"), "unregistered");
});

check("secret flag and metadata surface via enumeration (never values)", () => {
  registerEnvironmentVariable({
    name: "TEST_ENVREG_SECRET",
    description: "a secret test variable",
    secret: true,
    category: "sitespecific.t631.client",
  });
  setEnvironmentVariable("TEST_ENVREG_SECRET", "s3cr3t");
  const info = listEnvironmentVariables().find((v) => v.name === "TEST_ENVREG_SECRET");
  assert(info, "enumeration missing TEST_ENVREG_SECRET");
  assert(info!.secret === true, "secret flag lost");
  assert(info!.category === "sitespecific.t631.client", "category lost");
  assert(info!.isSet === true, "isSet should be true");
  assert(!JSON.stringify(info).includes("s3cr3t"), "enumeration leaked the value");
});

check("declaration transform hook filters values on read", () => {
  registerEnvironmentVariable({
    name: "TEST_ENVREG_TRANSFORM",
    description: "transformed variable",
    secret: false,
    category: "core",
    transform: (v) => (v ?? "default").toUpperCase(),
  });
  setEnvironmentVariable("TEST_ENVREG_TRANSFORM", "abc");
  assert(getEnvironmentVariable("TEST_ENVREG_TRANSFORM") === "ABC", "transform not applied");
});

check("runtime override applies after transform and can be removed", () => {
  setEnvironmentVariableOverride("TEST_ENVREG_TRANSFORM", (v) => `${v}-OVR`);
  assert(getEnvironmentVariable("TEST_ENVREG_TRANSFORM") === "ABC-OVR", "override not applied");
  setEnvironmentVariableOverride("TEST_ENVREG_TRANSFORM", null);
  assert(getEnvironmentVariable("TEST_ENVREG_TRANSFORM") === "ABC", "override not removed");
  assertThrows(() => setEnvironmentVariableOverride("TEST_ENVREG_NOPE", (v) => v), "unregistered");
});

check("required flag throws when unset", () => {
  registerEnvironmentVariable({
    name: "TEST_ENVREG_REQUIRED",
    description: "required variable",
    secret: false,
    category: "core",
    required: true,
  });
  assertThrows(() => getEnvironmentVariable("TEST_ENVREG_REQUIRED"), "required");
  setEnvironmentVariable("TEST_ENVREG_REQUIRED", "present");
  assert(getEnvironmentVariable("TEST_ENVREG_REQUIRED") === "present", "required read failed");
});

check("re-registration is idempotent (last declaration wins)", () => {
  registerEnvironmentVariables([
    { name: "TEST_ENVREG_PLAIN", description: "updated description", secret: true, category: "platform" },
  ]);
  const info = listEnvironmentVariables().find((v) => v.name === "TEST_ENVREG_PLAIN");
  assert(info!.description === "updated description", "description not updated");
  assert(info!.secret === true, "secret not updated");
});

check("dynamic registration at parse time (FILESYSTEMS-style indirection)", () => {
  const dynamicName = "TEST_ENVREG_DYNAMIC_SECRET";
  // Simulate a config parser encountering a *_secret setting naming an env var.
  registerEnvironmentVariable({
    name: dynamicName,
    description: 'Secret referenced by FILESYSTEMS filesystem "test" setting "key_secret".',
    secret: true,
    category: "core",
  });
  setEnvironmentVariable(dynamicName, "dyn");
  assert(getEnvironmentVariable(dynamicName) === "dyn", "dynamic read failed");
  const info = listEnvironmentVariables().find((v) => v.name === dynamicName);
  assert(info!.secret === true, "dynamic registration must be secret");
});

check("presence enumeration returns names only", () => {
  const names = listPresentEnvironmentVariableNames((n) => n.startsWith("TEST_ENVREG_"));
  assert(names.includes("TEST_ENVREG_PLAIN"), "present name missing");
  assert(names.every((n) => typeof n === "string"), "names only");
});

check("getRawProcessEnv returns the process environment object", () => {
  assert(getRawProcessEnv()["TEST_ENVREG_PLAIN"] === "hello", "raw env mismatch");
});

console.log("[test-env-registry] enforcement script");

check("check-env-registry passes on the current working tree", () => {
  execSync("npx tsx scripts/dev/check-env-registry.ts", { stdio: "pipe" });
});

check("check-env-registry flags a violating untracked file", () => {
  const dir = mkdtempSync(join(tmpdir(), "envreg-"));
  // Must live inside a scanned prefix; use scripts/oneoffs with a unique name.
  const bad = "scripts/oneoffs/__envreg_check_violation_test.ts";
  writeFileSync(bad, "const x = process.env.SNEAKY_VAR;\nexport default x;\n");
  try {
    let failed = false;
    let output = "";
    try {
      execSync("npx tsx scripts/dev/check-env-registry.ts", { stdio: "pipe" });
    } catch (err: any) {
      failed = true;
      output = String(err.stdout) + String(err.stderr);
    }
    assert(failed, "check should have failed");
    assert(output.includes(bad), "violation file not reported");
  } finally {
    rmSync(bad, { force: true });
    rmSync(dir, { recursive: true, force: true });
  }
});

check("check-env-registry ignores the exempt cjs helper", () => {
  // scripts/post-merge-db-push.cjs contains process.env but is exempt; the
  // "passes on current tree" test above already proves this holds, so just
  // sanity-check the file still contains the passthrough.
  const content = execSync("cat scripts/post-merge-db-push.cjs", { encoding: "utf8" });
  assert(content.includes("process.env"), "exempt file no longer uses process.env?");
});

if (failures > 0) {
  console.error(`[test-env-registry] ${failures} failure(s)`);
  process.exit(1);
}
console.log("[test-env-registry] all tests passed");

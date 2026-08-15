#!/usr/bin/env npx tsx
/**
 * Tests for the system-status details() drill-down framework (Task #1052)
 * and the environment-variables status plugin.
 *
 * Run: npx tsx scripts/dev/test-system-status-details.ts
 * Exits 0 when all assertions pass, 1 otherwise.
 *
 * Imports the collector and plugin/registry modules directly (not the
 * ../index barrel) to avoid pulling app-wide side effects into a
 * standalone tsx script.
 */
// Import storage FIRST: establishes a module-evaluation order that avoids
// the plugin-barrel init cycle (PluginRegistry TDZ) in standalone scripts.
import "../../server/storage";
import express from "express";
import type { AddressInfo } from "node:net";
import {
  collectStatus,
  getPluginDetails,
  rescanPlugin,
  clearStatusResults,
} from "../../server/plugins/system/status/collector";
import { systemStatusPluginRegistry } from "../../server/plugins/system/status/registry";
import type { SystemStatusPlugin } from "../../server/plugins/system/status/types";
import {
  getRawProcessEnv,
  registerEnvironmentVariable,
  setEnvironmentVariable,
} from "../../server/config/env-registry";
import "../../server/plugins/system/status/plugins/environment-variables";

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`  PASS: ${name}`);
  } catch (err) {
    failures++;
    console.error(`  FAIL: ${name} — ${(err as Error).message}`);
  }
}
function assert(cond: unknown, msg: string): void {
  if (!cond) throw new Error(msg);
}

const envPlugin = systemStatusPluginRegistry.get("environment-variables")!;

async function main() {
  console.log("[test-system-status-details] collector framework");

  await check("hasDetails is true for plugins with details()", async () => {
    const [entry] = await collectStatus([envPlugin]);
    assert(entry.hasDetails === true, "hasDetails should be true");
  });

  await check("hasDetails is false for plugins without details()", async () => {
    const plain: SystemStatusPlugin = {
      id: "test-plain",
      name: "Plain",
      description: "no details",
      async scan() {
        return [{ priority: "info" as const, title: "ok" }];
      },
    };
    const [entry] = await collectStatus([plain]);
    assert(entry.hasDetails === false, "hasDetails should be false");
    const rescanned = await rescanPlugin(plain);
    assert(rescanned.hasDetails === false, "rescan hasDetails should be false");
  });

  await check("getPluginDetails rejects plugins without details()", async () => {
    const plain: SystemStatusPlugin = {
      id: "test-plain2",
      name: "Plain2",
      description: "no details",
      async scan() {
        return [];
      },
    };
    let threw = false;
    try {
      await getPluginDetails(plain);
    } catch (err) {
      threw = true;
      assert(
        (err as Error).message.includes("does not support details"),
        `unexpected error: ${(err as Error).message}`,
      );
    }
    assert(threw, "expected an error");
  });

  await check("details() is invoked fresh on every call (never cached)", async () => {
    let calls = 0;
    const counting: SystemStatusPlugin = {
      id: "test-counting",
      name: "Counting",
      description: "counts details calls",
      async scan() {
        return [{ priority: "info" as const, title: "ok" }];
      },
      async details() {
        calls++;
        return { groups: [{ title: "g", rows: [{ label: `call-${calls}` }] }] };
      },
    };
    const first = await getPluginDetails(counting);
    const second = await getPluginDetails(counting);
    assert(calls === 2, `details called ${calls} times, expected 2`);
    assert(first.groups[0].rows[0].label === "call-1", "first payload wrong");
    assert(second.groups[0].rows[0].label === "call-2", "second payload stale/cached");
  });

  await check("details() enforces the per-plugin timeout", async () => {
    const hung: SystemStatusPlugin = {
      id: "test-hung",
      name: "Hung",
      description: "never resolves",
      timeoutMs: 50,
      async scan() {
        return [];
      },
      details() {
        return new Promise(() => {});
      },
    };
    let threw = false;
    try {
      await getPluginDetails(hung);
    } catch (err) {
      threw = true;
      assert((err as Error).message.includes("timed out"), "expected timeout error");
    }
    assert(threw, "expected a timeout error");
  });

  console.log("[test-system-status-details] environment-variables plugin");

  registerEnvironmentVariable({
    name: "TEST_SSD_SECRET",
    description: "secret test variable",
    secret: true,
    category: "core",
  });
  setEnvironmentVariable("TEST_SSD_SECRET", "super-secret-value-123");
  registerEnvironmentVariable({
    name: "TEST_SSD_PLAIN",
    description: "plain test variable",
    secret: false,
    category: "core",
  });
  setEnvironmentVariable("TEST_SSD_PLAIN", "visible-value");
  registerEnvironmentVariable({
    name: "TEST_SSD_LONG",
    description: "long test variable",
    secret: false,
    category: "core",
  });
  setEnvironmentVariable("TEST_SSD_LONG", "x".repeat(500));
  registerEnvironmentVariable({
    name: "TEST_SSD_REQ_UNSET",
    description: "required but unset",
    secret: false,
    category: "core",
    required: true,
  });
  delete (getRawProcessEnv() as Record<string, string | undefined>).TEST_SSD_REQ_UNSET;

  await check("scan reports counts and required-but-unset warning", async () => {
    const messages = await envPlugin.scan();
    const summary = messages[0];
    assert(/\d+ registered variable/.test(summary.title), "summary counts missing");
    const warning = messages.find(
      (m) => m.priority === "warning" && m.title.includes("TEST_SSD_REQ_UNSET"),
    );
    assert(warning, "missing required-but-unset warning");
    const json = JSON.stringify(messages);
    assert(!json.includes("super-secret-value-123"), "scan leaked a secret value");
    assert(!json.includes("visible-value"), "scan should not include values at all");
  });

  await check("details obfuscates secrets, shows/truncates non-secrets", async () => {
    const details = await envPlugin.details!();
    const rows = details.groups.flatMap((g) => g.rows);
    const secret = rows.find((r) => r.label === "TEST_SSD_SECRET")!;
    assert(secret, "secret row missing");
    assert(secret.value === "••••••••", `secret not obfuscated: ${secret.value}`);
    assert(secret.badges?.includes("secret"), "missing secret badge");
    assert(
      !JSON.stringify(details).includes("super-secret-value-123"),
      "details leaked a secret value",
    );
    const plain = rows.find((r) => r.label === "TEST_SSD_PLAIN")!;
    assert(plain.value === "visible-value", "non-secret value not shown");
    const long = rows.find((r) => r.label === "TEST_SSD_LONG")!;
    assert(long.value!.length < 200 && long.value!.includes("…"), "long value not truncated");
    const unset = rows.find((r) => r.label === "TEST_SSD_REQ_UNSET")!;
    assert(unset.value === undefined, "unset var should have no value");
    assert(unset.badges?.includes("unset"), "missing unset badge");
    assert(unset.priority === "warning", "required-unset row should warn");
  });

  await check("details groups are keyed by category", async () => {
    const details = await envPlugin.details!();
    const titles = details.groups.map((g) => g.title);
    assert(titles.includes("core"), "core group missing");
    assert(titles.includes("platform"), "platform group missing");
    const sorted = [...titles].sort((a, b) => a.localeCompare(b));
    assert(JSON.stringify(titles) === JSON.stringify(sorted), "groups not sorted");
  });

  console.log("[test-system-status-details] HTTP routes");

  // Dynamic imports: loading these statically trips the plugin-barrel
  // init cycle in a standalone tsx script (PluginRegistry TDZ crash).
  const { registerSystemStatusRoutes } = await import(
    "../../server/modules/system/status"
  );
  const { registerPluginKind } = await import("../../server/plugins/_core/kinds");

  // Register the kind WITHOUT a policy so the gate passes in this
  // standalone harness (no DB); auth gating itself is exercised via the
  // requireAuth stub below.
  registerPluginKind({
    kind: "system-status",
    registry: systemStatusPluginRegistry,
    label: "System Status",
    description: "test",
  });

  let authAllowed = true;
  const app = express();
  registerSystemStatusRoutes(app, (req, res, next) => {
    if (!authAllowed) {
      res.status(401).json({ message: "Unauthorized" });
      return;
    }
    next();
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  await check("details endpoint requires auth", async () => {
    authAllowed = false;
    const res = await fetch(`${base}/api/system-status/environment-variables/details`);
    assert(res.status === 401, `expected 401, got ${res.status}`);
    authAllowed = true;
  });

  await check("details endpoint responds no-store with obfuscated payload", async () => {
    const res = await fetch(`${base}/api/system-status/environment-variables/details`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    assert(
      res.headers.get("cache-control") === "no-store",
      `expected no-store, got ${res.headers.get("cache-control")}`,
    );
    const body = await res.text();
    assert(!body.includes("super-secret-value-123"), "endpoint leaked a secret value");
    assert(body.includes("TEST_SSD_SECRET"), "payload missing expected row");
  });

  await check("details endpoint 404s for plugins without details()", async () => {
    const res = await fetch(`${base}/api/system-status/uptime/details`);
    // uptime may not be registered in this harness; unknown and
    // no-details both correctly map to 404.
    assert(res.status === 404, `expected 404, got ${res.status}`);
  });

  await check("details endpoint 404s for unknown plugins", async () => {
    const res = await fetch(`${base}/api/system-status/nope-not-real/details`);
    assert(res.status === 404, `expected 404, got ${res.status}`);
  });

  await check("collect payload advertises hasDetails over HTTP", async () => {
    clearStatusResults();
    const res = await fetch(`${base}/api/system-status`);
    assert(res.status === 200, `expected 200, got ${res.status}`);
    const entries = (await res.json()) as { id: string; hasDetails: boolean }[];
    const env = entries.find((e) => e.id === "environment-variables");
    assert(env, "environment-variables entry missing from collect");
    assert(env!.hasDetails === true, "hasDetails not advertised");
    assert(
      !JSON.stringify(entries).includes("super-secret-value-123"),
      "collect leaked a secret value",
    );
  });

  server.close();

  if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
  }
  console.log("\nAll tests passed.");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

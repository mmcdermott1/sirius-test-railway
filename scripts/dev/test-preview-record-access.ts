#!/usr/bin/env tsx
/**
 * Test Preview Record Access
 *
 * The Template Studio's record picker lets an author find a real record
 * and preview a template against it. That is a READ of the record, and
 * the only thing standing between an author and every record of a
 * previewable kind is the kind's declared gate — run over each search
 * result, and again on the load by id.
 *
 * Both halves matter, and they fail differently: a search that skipped
 * the gate would ADVERTISE records the author cannot open (a listing
 * leak of names and hints, even if loading then refused), while a load
 * that skipped it would hand over the record itself to anyone who
 * guessed an id. So both are asserted here, for both kinds of gate:
 *
 *  - a `record` gate is asked per record, on the subject id the record
 *    yields (a dispatch availability row is read as a read of its
 *    worker), so one denied record disappears while its neighbours stay;
 *  - a `route` gate is the broad page gate, so a denial takes the whole
 *    kind — nothing listed, nothing loadable.
 *
 * The access check is injected, so this asserts the ENFORCEMENT rather
 * than re-testing the policy evaluator: the caller's verdicts are fixed
 * up front and the test watches what the picker does with them.
 *
 * Run with:  npx tsx scripts/dev/test-preview-record-access.ts
 */
// The event-notifier barrel first: importing the tokens barrel ahead of
// it initializes the shared plugin registry mid-cycle and crashes.
import { initializeEventNotifierPluginSystem } from "../../server/plugins/event-notifier";
import { initializeTokenPluginSystem } from "../../server/plugins/tokens";
import { registerTokenPlugin } from "../../server/plugins/tokens/registry";
import {
  resolveTokenPreviewEntity,
  searchTokenPreviewRecords,
  type TokenPreviewAccessCheck,
} from "../../server/plugins/tokens/preview-entities";
import type { IStorage } from "../../server/storage";

let failures = 0;

function check(label: string, ok: boolean, detail?: unknown): void {
  if (!ok) failures++;
  const suffix =
    detail === undefined ? "" : ` :: ${JSON.stringify(detail).slice(0, 300)}`;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${suffix}`);
}

/**
 * Two throwaway kinds that exist only in this test, so the assertions
 * are about the enforcement itself and not about whichever real kinds
 * happen to be declared today. Their records live in memory: no
 * database, no fixtures to keep in step with a schema.
 */
const RECORDS = [
  { id: "rec-open", subject: "subject-open", label: "Open record" },
  { id: "rec-denied", subject: "subject-denied", label: "Denied record" },
];

function registerTestKinds(): void {
  for (const [kind, gate] of [
    ["test_preview_record_scope", { scope: "record" as const, policy: "worker.view" }],
    ["test_preview_route_scope", { scope: "route" as const, policy: "staff" }],
  ] as const) {
    registerTokenPlugin({
      metadata: {
        id: `token.${kind}`,
        name: kind,
        description: "Throwaway preview kind for the access test",
        segmentName: `__${kind}`,
        inputTypes: [],
        outputType: kind,
        hiddenFromCatalog: true,
        previewEntity: {
          gate,
          async search() {
            return RECORDS.map((r) => ({
              id: r.id,
              label: r.label,
              gateEntityId: r.subject,
            }));
          },
          async load(_storage, id) {
            const row = RECORDS.find((r) => r.id === id);
            if (!row) return null;
            return {
              entity: { kind, row: { id: row.id } },
              label: row.label,
              gateEntityId: row.subject,
            };
          },
        },
      },
      async resolve() {
        return null;
      },
    });
  }
}

/** Grants everything except the one record the test denies. */
const denyOne: TokenPreviewAccessCheck = async (_policy, entityId) => {
  if (entityId === "subject-denied") {
    return { granted: false, reason: "Not yours" };
  }
  return { granted: true };
};

const denyAll: TokenPreviewAccessCheck = async () => ({
  granted: false,
  reason: "Not staff",
});

async function main(): Promise<void> {
  initializeEventNotifierPluginSystem();
  initializeTokenPluginSystem();
  registerTestKinds();

  // Never touched: every kind under test answers from memory.
  const storage = {} as IStorage;
  const req = {} as any;

  // ── A record gate hides exactly the record it denies ──────────────────────
  const recordSearch = await searchTokenPreviewRecords(
    "test_preview_record_scope",
    "",
    10,
    { storage, req, checkAccess: denyOne },
  );
  const listed = recordSearch.ok ? recordSearch.records.map((r) => r.id) : [];
  check(
    "search lists a record the caller may read",
    listed.includes("rec-open"),
    listed,
  );
  check(
    "search never lists a record the caller may not read",
    !listed.includes("rec-denied"),
    listed,
  );

  const openLoad = await resolveTokenPreviewEntity(
    "test_preview_record_scope",
    "rec-open",
    { storage, req, checkAccess: denyOne },
  );
  check("load returns a record the caller may read", openLoad.ok, openLoad);

  const deniedLoad = await resolveTokenPreviewEntity(
    "test_preview_record_scope",
    "rec-denied",
    { storage, req, checkAccess: denyOne },
  );
  check(
    "load refuses a record the caller may not read",
    !deniedLoad.ok && deniedLoad.status === 403,
    deniedLoad,
  );
  check(
    "a refused load hands back no record at all",
    !("entity" in deniedLoad),
    Object.keys(deniedLoad),
  );

  // ── A route gate takes the whole kind with it ─────────────────────────────
  const routeSearch = await searchTokenPreviewRecords(
    "test_preview_route_scope",
    "",
    10,
    { storage, req, checkAccess: denyAll },
  );
  check(
    "a denied route gate lists nothing",
    routeSearch.ok && routeSearch.records.length === 0,
    routeSearch,
  );
  const routeLoad = await resolveTokenPreviewEntity(
    "test_preview_route_scope",
    "rec-open",
    { storage, req, checkAccess: denyAll },
  );
  check(
    "a denied route gate loads nothing",
    !routeLoad.ok && routeLoad.status === 403,
    routeLoad,
  );
  const routeAllowed = await searchTokenPreviewRecords(
    "test_preview_route_scope",
    "",
    10,
    { storage, req, checkAccess: async () => ({ granted: true }) },
  );
  check(
    "a granted route gate lists the kind's records",
    routeAllowed.ok && routeAllowed.records.length === RECORDS.length,
    routeAllowed,
  );

  // ── A kind that declares nothing is not previewable ───────────────────────
  const undeclaredSearch = await searchTokenPreviewRecords(
    "address",
    "",
    10,
    { storage, req, checkAccess: async () => ({ granted: true }) },
  );
  check(
    "an undeclared kind cannot be searched",
    !undeclaredSearch.ok && undeclaredSearch.status === 400,
    undeclaredSearch,
  );
  const undeclaredLoad = await resolveTokenPreviewEntity("address", "x", {
    storage,
    req,
    checkAccess: async () => ({ granted: true }),
  });
  check(
    "an undeclared kind cannot be loaded by id",
    !undeclaredLoad.ok && undeclaredLoad.status === 400,
    undeclaredLoad,
  );

  console.log(
    failures === 0
      ? "\nPASS: a record the caller cannot read is neither listed nor loadable"
      : `\nFAIL: ${failures} preview record-access problem(s)`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

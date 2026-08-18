#!/usr/bin/env tsx
/**
 * Test Preview Context Safety
 *
 * POST /api/template-studio/preview renders tokenized text against a
 * context, and a context comes in ONE form: real records, named by kind
 * and id. Seeding one is a read of that record, so the token kind's own
 * declaration decides whether this caller may read it, and a kind that
 * has declared nothing is refused outright — silence means "not
 * previewable", never "open".
 *
 * The route used to take a second form — raw root VALUES the author
 * already had on screen — accepted on the plain staff gate with no
 * per-record check, which took a wall of guards to keep from reaching a
 * record through a foreign key. Nothing ever sent it, so the form and
 * its guards are gone. What remains is the obligation to say so: a
 * caller sending a shape this route no longer has is describing a
 * render it will not get, and quietly rendering something else is the
 * one lie a preview must never tell.
 *
 * This test drives the real route (no mocks of the module under test)
 * and asserts: the records form fails closed for an undeclared kind,
 * every retired shape is REFUSED by presence rather than ignored, and
 * no context at all renders samples only.
 *
 * Run with:  npx tsx scripts/dev/test-preview-context-safety.ts
 */
import express from "express";
import { storage } from "../../server/storage";
import { loadComponentCache } from "../../server/services/component-cache";
import { initializeTokenPluginSystem } from "../../server/plugins/tokens";
import { registerTokenStudioRoutes } from "../../server/modules/token-studio";
import { NOTIFIER_CHANNEL_FIELDS } from "../../shared/delivery-fields";

let failures = 0;

function check(label: string, ok: boolean, detail?: unknown): void {
  if (!ok) failures++;
  const suffix =
    detail === undefined ? "" : ` :: ${JSON.stringify(detail).slice(0, 300)}`;
  console.log(`${ok ? "PASS" : "FAIL"} ${label}${suffix}`);
}

async function main(): Promise<void> {
  await loadComponentCache();
  initializeTokenPluginSystem();

  // The route as it is really mounted, with auth satisfied: this test is
  // about what a caller who IS staff can reach, not about the gate that
  // lets them in.
  const app = express();
  app.use(express.json());
  const requireAuth = (_req: any, _res: any, next: any) => next();
  const requireAccess = () => (_req: any, _res: any, next: any) => next();
  registerTokenStudioRoutes(
    app as any,
    requireAuth as any,
    requireAccess as any,
    storage,
  );
  const server = app.listen(0);
  const port = (server.address() as any).port;

  const preview = async (body: unknown) => {
    const res = await fetch(
      `http://127.0.0.1:${port}/api/template-studio/preview`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      },
    );
    return { status: res.status, body: (await res.json()) as any };
  };

  const textField = [{ key: "subject", syntax: "text" as const }];
  const anyId = "00000000-0000-0000-0000-000000000000";

  // ── The records form fails closed ─────────────────────────────────────────
  // `address` is a real token entity kind that no root accepts and that
  // declares nothing about how a preview read of it is gated, so it
  // cannot be named at all. (The per-kind declaration check itself is
  // asserted directly in `test-preview-record-access.ts`.)
  const undeclared = await preview({
    fields: textField,
    values: { subject: "x" },
    context: { entities: [{ kind: "address", id: anyId }] },
  });
  check(
    "a context fails closed for an undeclared kind",
    undeclared.status === 400,
    undeclared.body,
  );

  // ── Retired shapes are refused, not ignored ───────────────────────────────
  // Each of these was a real shape this route once served. Refusal is by
  // PRESENCE, not truthiness: `null` is valid JSON, and a key that is
  // present but empty is still a caller describing a render it will not
  // get. (An `entity: null` that was ignored rather than refused is how
  // this rule was learned.)
  for (const [label, context, expect] of [
    [
      "the retired single-entity form",
      { entity: { kind: "address", id: anyId } },
      /no single "entity" form/,
    ],
    ["an empty retired entity key", { entity: null, entities: [] }, /no single "entity" form/],
    [
      "the retired raw root values form",
      { roots: { contact: { displayName: "Ford Prefect" } } },
      /no longer takes raw root values/,
    ],
    ["an empty retired roots key", { entities: [], roots: null }, /no longer takes raw root values/],
    [
      "the retired form discriminant",
      { source: "records", entities: [] },
      /only one form and does not name it/,
    ],
    ["an empty retired source key", { source: null, entities: [] }, /only one form and does not name it/],
  ] as const) {
    const res = await preview({
      fields: textField,
      values: { subject: "x" },
      context,
    });
    check(
      `a context refuses ${label}`,
      res.status === 400 && expect.test(res.body.message ?? ""),
      res.body,
    );
  }

  // ── A context that names nothing is refused too ───────────────────────────
  // The one form has one payload; a context without it is not a context.
  const empty = await preview({
    fields: textField,
    values: { subject: "x" },
    context: {},
  });
  check("a context with no entities is refused", empty.status === 400, empty.body);

  // ── With no context at all, nothing real is rendered ──────────────────────
  const samples = await preview({
    fields: NOTIFIER_CHANNEL_FIELDS.email,
    values: { subject: "Hi {{contact}}", bodyHtml: "<p>Hi {{contact}}</p>" },
  });
  check(
    "no context renders samples only",
    samples.body.sample === true && samples.body.contactId === null,
    { sample: samples.body.sample, contactId: samples.body.contactId },
  );

  server.close();

  console.log(
    failures === 0
      ? "\nPASS: a preview context cannot reach a record the caller was not gated for"
      : `\nFAIL: ${failures} preview-context safety problem(s)`,
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

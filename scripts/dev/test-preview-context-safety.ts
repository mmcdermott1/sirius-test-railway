#!/usr/bin/env tsx
/**
 * Test Preview Context Safety
 *
 * POST /api/template-studio/preview renders tokenized text against a
 * context, and a context comes in ONE form: a seed per root, each
 * naming either a real record or a sample persona. Seeding a record is
 * a read of it, so the token kind's own declaration decides whether
 * this caller may read it, and a kind that has declared nothing is
 * refused outright — silence means "not previewable", never "open".
 *
 * The route used to take other forms — raw root VALUES the author
 * already had on screen, a bare list of records, one persona for the
 * whole render. None survive. What remains is the obligation to say so:
 * a caller sending a shape this route no longer has is describing a
 * render it will not get, and quietly rendering something else is the
 * one lie a preview must never tell.
 *
 * This test drives the real route (no mocks of the module under test)
 * and asserts: a seeded record fails closed for an undeclared kind,
 * every retired shape is REFUSED by presence rather than ignored, and
 * no context at all renders samples only.
 *
 * Run with:  npx tsx scripts/dev/test-preview-context-safety.ts
 */
import express from "express";
import { storage } from "../../server/storage";
import { loadComponentCache } from "../../server/services/component-cache";
import { initializeTokenPluginSystem } from "../../server/plugins/tokens";
import { listSampleSetChoicesForKind } from "../../server/plugins/tokens/sample-sets";
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
  // A persona the contact root really offers, so the assertions below
  // fail on what they are about rather than on an unknown id.
  const persona = listSampleSetChoicesForKind("contact")[0].id;

  // ── The records form fails closed ─────────────────────────────────────────
  // `address` is a real token entity kind that no root accepts and that
  // declares nothing about how a preview read of it is gated, so it
  // cannot be named at all. (The per-kind declaration check itself is
  // asserted directly in `test-preview-record-access.ts`.)
  const undeclared = await preview({
    fields: textField,
    values: { subject: "x" },
    rootNames: ["contact"],
    context: {
      seeds: [{ rootName: "contact", record: { kind: "address", id: anyId } }],
    },
  });
  check(
    "a seed fails closed for an undeclared kind",
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
    ["an empty retired entity key", { entity: null, seeds: [] }, /no single "entity" form/],
    [
      "the retired bare records list",
      { entities: [{ kind: "contact", id: anyId }] },
      /no longer takes an "entities" list/,
    ],
    ["an empty retired entities key", { entities: null, seeds: [] }, /no longer takes an "entities" list/],
    [
      "the retired raw root values form",
      { roots: { contact: { displayName: "Ford Prefect" } } },
      /no longer takes raw root values/,
    ],
    ["an empty retired roots key", { seeds: [], roots: null }, /no longer takes raw root values/],
    [
      "the retired form discriminant",
      { source: "records", seeds: [] },
      /only one form and does not name it/,
    ],
    ["an empty retired source key", { source: null, seeds: [] }, /only one form and does not name it/],
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
  check("a context with no seeds is refused", empty.status === 400, empty.body);

  // ── One persona for the whole render is gone ──────────────────────────────
  // The persona is now chosen per root, inside the seeds, so a
  // render-wide one at the top of the body would silently apply to
  // nothing.
  const globalPersona = await preview({
    fields: textField,
    values: { subject: "x" },
    sampleSetId: null,
  });
  check(
    "a render-wide sample persona is refused",
    globalPersona.status === 400 &&
      /no longer takes one sample persona/.test(globalPersona.body.message ?? ""),
    globalPersona.body,
  );

  // ── A seed says exactly one thing ─────────────────────────────────────────
  const bothAtOnce = await preview({
    fields: textField,
    values: { subject: "x" },
    rootNames: ["contact"],
    context: {
      seeds: [
        {
          rootName: "contact",
          record: { kind: "contact", id: anyId },
          sampleSetId: persona,
        },
      ],
    },
  });
  check(
    "a seed naming both a record and a persona is refused",
    bothAtOnce.status === 400,
    bothAtOnce.body,
  );

  const unknownRoot = await preview({
    fields: textField,
    values: { subject: "x" },
    rootNames: ["contact"],
    context: { seeds: [{ rootName: "no_such_root", sampleSetId: persona }] },
  });
  check(
    "a seed for a root these templates do not address is refused",
    unknownRoot.status === 400,
    unknownRoot.body,
  );

  // The caller's root list is the WHOLE list: a root that exists in the
  // registry but that this render does not name is not seedable either.
  // That is what lets a surface offer only the roots its author can
  // really pick (a notifier offers the recipient contact, never a
  // free-floating worker, because delivery resolves the worker FROM the
  // recipient).
  const unnamedRoot = await preview({
    fields: textField,
    values: { subject: "x" },
    rootNames: ["event"],
    context: { seeds: [{ rootName: "contact", sampleSetId: persona }] },
  });
  check(
    "a seed for a real root this render did not name is refused",
    unnamedRoot.status === 400 &&
      /No preview root named "contact"/.test(unnamedRoot.body.message ?? ""),
    unnamedRoot.body,
  );

  const twice = await preview({
    fields: textField,
    values: { subject: "x" },
    rootNames: ["contact"],
    context: {
      seeds: [
        { rootName: "contact", sampleSetId: persona },
        { rootName: "contact", sampleSetId: persona },
      ],
    },
  });
  check(
    "a root seeded twice is refused",
    twice.status === 400 && /more than once/.test(twice.body.message ?? ""),
    twice.body,
  );

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

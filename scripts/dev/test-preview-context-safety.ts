#!/usr/bin/env tsx
/**
 * Test Preview Context Safety
 *
 * POST /api/template-studio/preview renders tokenized text against a
 * context, and it takes that context in two forms with two very
 * different trust levels. A context NAMES its form — `source: "values"`
 * or `source: "records"` — precisely because the form decides which
 * trust level applies, and that must never be inferred:
 *
 *  - `source: "records"` names real records (kind + id). Seeding one is
 *    a read of that record, so the token kind's own declaration decides
 *    whether this caller may read it, and a kind that has declared
 *    nothing is refused outright.
 *  - `source: "values"` is RAW ROOT VALUES — the text the author already
 *    has on screen. They are accepted on the route's plain staff gate,
 *    with no per-record check, and that is only defensible while they
 *    cannot reach a record.
 *
 * The danger is the seam between the two: token plugins traverse to
 * related records by reading a foreign key off the row they stand on,
 * and the render treats a seeded contact's `id` as the recipient. So a
 * raw row carrying `grievanceId` or `id` would let a caller name any
 * record in the database and read it back through a relation — walking
 * straight around the gate the records form exists to apply.
 *
 * This test drives the real route (no mocks of the module under test)
 * and asserts the seam is closed: identifiers and nested records are
 * refused in a raw context, a raw context can never set the recipient
 * or resolve a relation, the records form still fails closed, and a
 * context that does not declare its form is refused rather than guessed.
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

  const textField = [{ key: "subject", media: "text" as const }];

  // ── A raw context cannot carry an identifier ──────────────────────────────
  // Each of these is a real traversal vector, not a hypothetical one:
  // `id` becomes the recipient contact, the suffixed forms are the
  // foreign keys relation plugins read.
  for (const key of [
    "id",
    "ID",
    "grievanceId",
    "grievanceID",
    "grievance_id",
    "worker_id",
    "WORKER_ID",
  ]) {
    const res = await preview({
      fields: textField,
      values: { subject: "x" },
      context: {
        source: "values",
        roots: { contact: { [key]: "00000000-0000-0000-0000-000000000000" } },
      },
    });
    check(`raw context refuses identifier "${key}"`, res.status === 400, res.body);
  }

  // ── …but ordinary words that end in those letters are still fine ──────────
  // The identifier rule must not eat perfectly good field names, or a
  // caller learns to work around it.
  for (const key of ["paid", "valid", "void", "uuid", "grid"]) {
    const res = await preview({
      fields: textField,
      values: { subject: 'Hello {{contact.field(name="displayName")}}' },
      context: {
        source: "values",
        roots: { contact: { [key]: "Yes", displayName: "Ford Prefect" } },
      },
    });
    check(
      `raw context still accepts a field named "${key}"`,
      res.status === 200 &&
        res.body.fields?.subject?.rendered === "Hello Ford Prefect",
      res.body.message ?? res.body.fields?.subject,
    );
  }

  // ── A raw context cannot smuggle a related record ─────────────────────────
  const nested = await preview({
    fields: textField,
    values: { subject: "x" },
    context: {
      source: "values",
      roots: {
        contact: { grievance: { id: "00000000-0000-0000-0000-000000000000" } },
      },
    },
  });
  check("raw context refuses a nested record", nested.status === 400, nested.body);

  // ── A raw context never becomes the recipient ─────────────────────────────
  // Recipient-rooted roots (worker, employer) load from the recipient
  // contact. An accepted raw contact must leave that empty, or the roots
  // it did not seed would resolve against a real person.
  const rawContact = await preview({
    fields: textField,
    values: { subject: 'Hello {{contact.field(name="displayName")}}' },
    context: { source: "values", roots: { contact: { displayName: "Ford Prefect" } } },
  });
  check(
    "raw context renders its own literal value",
    rawContact.body.fields?.subject?.rendered === "Hello Ford Prefect",
    rawContact.body.fields?.subject ?? rawContact.body,
  );
  check(
    "raw context sets no recipient contact",
    rawContact.body.contactId === null,
    { contactId: rawContact.body.contactId },
  );
  const realRoots = (rawContact.body.roots ?? []).filter((r: any) => r.real);
  check(
    "raw context makes exactly the roots it named real",
    realRoots.length === 1 && realRoots[0]?.name === "contact",
    realRoots,
  );
  check(
    "raw context reports no record id for the root it seeded",
    realRoots[0]?.recordId === null,
    realRoots[0],
  );

  // ── An unknown root is refused, so nothing is seeded blind ────────────────
  const unknownRoot = await preview({
    fields: textField,
    values: { subject: "x" },
    context: { source: "values", roots: { nonesuch: { a: "b" } } },
  });
  check("raw context refuses an unknown root", unknownRoot.status === 400, unknownRoot.body);

  // ── The records form still fails closed ───────────────────────────────────
  // `address` is a real token entity kind that no root accepts and that
  // declares nothing about how a preview read of it is gated, so it
  // cannot be named at all — silence means "not previewable", never
  // "open". (The per-kind declaration check itself is asserted directly
  // in `test-preview-record-access.ts`.)
  const records = await preview({
    fields: textField,
    values: { subject: "x" },
    context: {
      source: "records",
      entities: [{ kind: "address", id: "00000000-0000-0000-0000-000000000000" }],
    },
  });
  check(
    "records context fails closed for an undeclared kind",
    records.status === 400,
    records.body,
  );

  // ── A context must declare which form it is ───────────────────────────────
  // The form decides the trust level, so an undeclared context is
  // refused rather than sniffed from whichever keys are present.
  const untagged = await preview({
    fields: textField,
    values: { subject: "x" },
    context: { roots: { contact: { displayName: "x" } } },
  });
  check("a context must name its form", untagged.status === 400, untagged.body);

  // ── …and cannot carry the other form's payload ────────────────────────────
  // Silently ignoring the stowaway would mean rendering something other
  // than what the caller described.
  const mixedValues = await preview({
    fields: textField,
    values: { subject: "x" },
    context: {
      source: "values",
      roots: { contact: { displayName: "x" } },
      entities: [{ kind: "address", id: "00000000-0000-0000-0000-000000000000" }],
    },
  });
  check(
    "a values context refuses smuggled entities",
    mixedValues.status === 400,
    mixedValues.body,
  );
  const mixedRecords = await preview({
    fields: textField,
    values: { subject: "x" },
    context: {
      source: "records",
      entities: [],
      roots: { contact: { displayName: "x" } },
    },
  });
  check(
    "a records context refuses smuggled root values",
    mixedRecords.status === 400,
    mixedRecords.body,
  );

  // ── The retired single-record form is refused, not silently accepted ──────
  // It used to be a pure alias for a one-element list. A stale caller
  // must be told, not quietly served.
  const retired = await preview({
    fields: textField,
    values: { subject: "x" },
    context: {
      entity: { kind: "address", id: "00000000-0000-0000-0000-000000000000" },
    },
  });
  check(
    "the retired single-entity form is refused",
    retired.status === 400 && /no single "entity" form/.test(retired.body.message ?? ""),
    retired.body,
  );

  // ── …and refused on PRESENCE, not on being populated ──────────────────────
  // `null` is valid JSON, so a key that is present but empty is still a
  // caller describing a shape this route no longer has. Accepting it
  // would render something other than what the caller asked for.
  for (const [label, body] of [
    [
      "values",
      {
        source: "values",
        entity: null,
        roots: { contact: { displayName: "Ford Prefect" } },
      },
    ],
    ["records", { source: "records", entity: null, entities: [] }],
  ] as const) {
    const res = await preview({
      fields: textField,
      values: { subject: "x" },
      context: body,
    });
    check(
      `a ${label} context refuses an empty retired "entity" key`,
      res.status === 400 && /no single "entity" form/.test(res.body.message ?? ""),
      res.body,
    );
  }

  // Same rule for an empty stowaway of the other form's payload key.
  const emptyStowawayValues = await preview({
    fields: textField,
    values: { subject: "x" },
    context: {
      source: "values",
      roots: { contact: { displayName: "Ford Prefect" } },
      entities: null,
    },
  });
  check(
    "a values context refuses an empty entities key",
    emptyStowawayValues.status === 400,
    emptyStowawayValues.body,
  );
  const emptyStowawayRecords = await preview({
    fields: textField,
    values: { subject: "x" },
    context: { source: "records", entities: [], roots: null },
  });
  check(
    "a records context refuses an empty roots key",
    emptyStowawayRecords.status === 400,
    emptyStowawayRecords.body,
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

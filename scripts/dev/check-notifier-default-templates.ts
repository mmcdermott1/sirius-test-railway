/**
 * Regression check: the token-templated notifiers' DEFAULT messages must
 * keep the pre-token display semantics — status display labels
 * ("Not Available", "Locked"), operation-specific settlement prose with
 * formatted currency, the grievance title fallback chain, and
 * payload-snapshot rendering (an intervening save or delete must not
 * change or swallow the message).
 *
 * Run: npx tsx scripts/dev/check-notifier-default-templates.ts
 */
import { storage } from "../../server/storage/database";
import { loadComponentCache } from "../../server/services/component-cache";
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";

let failures = 0;
function check(label: string, actual: unknown, expectedSubstring: string) {
  const ok = typeof actual === "string" && actual.includes(expectedSubstring);
  console.log(`${ok ? "PASS" : "FAIL"}: ${label}`);
  if (!ok) {
    console.log(`  expected to contain: ${expectedSubstring}`);
    console.log(`  actual: ${String(actual)}`);
    failures++;
  }
}

async function main() {
  await loadComponentCache();
  await import("../../server/plugins/tokens/index");
  const { resolveTemplates, composeFromTemplates } = await import(
    "../../server/plugins/event-notifier/token-templates"
  );

  const [contact] = (
    await db.execute(sql`select id from contacts limit 1`)
  ).rows as { id: string }[];
  if (!contact) throw new Error("dev DB has no contacts to render against");
  const recipient = { contactId: contact.id };

  /** Seed every declared record root exactly as the dispatcher does. */
  async function buildSeeds(plugin: any, payload: unknown) {
    const seeds: Array<{ name: string; entity: unknown }> = [];
    for (const root of plugin.tokenTemplates.roots) {
      const entity = await root.build({ payload } as any);
      if (!entity) {
        if (root.optional) continue;
        return null;
      }
      seeds.push({ name: root.name, entity });
    }
    seeds.push({
      name: "event",
      entity: { kind: "event", row: { type: "test.event", firedAt: new Date() } },
    });
    return seeds;
  }

  async function render(plugin: any, medium: string, payload: unknown) {
    const seeds = await buildSeeds(plugin, payload);
    if (!seeds) return null;
    const templates = resolveTemplates(plugin, {});
    return composeFromTemplates(
      plugin,
      medium as any,
      recipient,
      seeds as any,
      templates,
      new Map(),
    );
  }
  const renderInapp = (plugin: any, payload: unknown) =>
    render(plugin, "inapp", payload);

  /** Assert legacy email CTA + SMS wording for a converted notifier. */
  async function checkChannels(
    label: string,
    plugin: any,
    payload: unknown,
    expected: { body: string; cta: string; path: string },
  ) {
    const [email, smsc] = await Promise.all([
      render(plugin, "email", payload),
      render(plugin, "sms", payload),
    ]);
    check(
      `${label} email bodyText legacy CTA`,
      email?.bodyText,
      `${expected.body}\n\n${expected.cta} `,
    );
    check(`${label} email bodyText URL`, email?.bodyText, expected.path);
    check(
      `${label} sms legacy wording`,
      smsc?.message,
      `${expected.body} View: `,
    );
    check(`${label} sms URL`, smsc?.message, expected.path);
  }

  // --- pure helpers: display-label + fallback semantics ---
  const { dispatchStatusLabel } = await import(
    "../../server/plugins/event-notifier/plugins/dispatch-status-notifier"
  );
  check(
    "dispatch status label not_available",
    dispatchStatusLabel("not_available"),
    "Not Available",
  );
  const { edlsStatusLabel } = await import(
    "../../server/plugins/event-notifier/plugins/edls-sheet-status-notifier"
  );
  check("edls status label lock", edlsStatusLabel("lock"), "Locked");
  const { settlementSummary, formatAmount } = await import(
    "../../server/plugins/event-notifier/plugins/grievance-settlement-notifier"
  );
  check(
    "settlement created sentence",
    settlementSummary("created", "T", "100.00"),
    "A settlement of $100 was added to the grievance T.",
  );
  check(
    "settlement deleted sentence",
    settlementSummary("deleted", "T", "100.50"),
    "A settlement of $100.50 was removed from the grievance T.",
  );
  check(
    "settlement updated sentence (legacy word order)",
    settlementSummary("updated", "T", "100.00"),
    "A settlement of $100 on the grievance T was updated.",
  );
  check(
    "settlement missing amount drops the clause",
    settlementSummary("created", "T", null),
    "A settlement was added to the grievance T.",
  );
  check("amount format cents", formatAmount("100.50") ?? "", "$100.50");
  const { edlsSheetDisplayTitle } = await import(
    "../../server/plugins/event-notifier/plugins/edls-sheet-status-notifier"
  );
  check(
    "edls blank title falls back to Sheet <id>",
    edlsSheetDisplayTitle("abcd1234-rest", "   "),
    "Sheet abcd1234",
  );
  const { composeGrievanceDisplayTitle } = await import(
    "../../server/plugins/tokens/plugins/grievance"
  );
  check(
    "grievance title: name wins",
    composeGrievanceDisplayTitle("abcd1234", {
      name: "My Grievance",
      categoryName: "Pay",
    }),
    "My Grievance",
  );
  check(
    "grievance title: category fallback",
    composeGrievanceDisplayTitle("abcd1234", {
      name: null,
      categoryName: "Pay",
    }),
    "Pay Grievance",
  );
  check(
    "grievance title: id fallback",
    composeGrievanceDisplayTitle("abcd1234-rest", undefined),
    "Grievance abcd1234",
  );

  // --- end-to-end default renders (payload snapshots; no live rows needed) ---
  const { dispatchStatusNotifier } = await import(
    "../../server/plugins/event-notifier/plugins/dispatch-status-notifier"
  );
  const ds = await renderInapp(dispatchStatusNotifier, {
    statusId: "s1",
    workerId: "00000000-0000-0000-0000-000000000000",
    status: "not_available",
    previousStatus: "available",
  });
  check(
    "dispatch-status default body",
    ds?.body,
    "Your dispatch status is now Not Available.",
  );
  await checkChannels(
    "dispatch-status",
    dispatchStatusNotifier,
    {
      statusId: "s1",
      workerId: "00000000-0000-0000-0000-000000000000",
      status: "not_available",
      previousStatus: "available",
    },
    {
      body: "Your dispatch status is now Not Available.",
      cta: "View your dispatch page:",
      path: "/workers/00000000-0000-0000-0000-000000000000/dispatch/status",
    },
  );

  const { edlsSheetStatusNotifier } = await import(
    "../../server/plugins/event-notifier/plugins/edls-sheet-status-notifier"
  );
  const es = await renderInapp(edlsSheetStatusNotifier, {
    sheetId: "00000000-0000-0000-0000-000000000000",
    previousStatus: "draft",
    newStatus: "lock",
    title: "Night Shift",
    ymd: "2026-01-08",
  });
  check("edls default body uses label", es?.body, 'the status "Locked"');
  check("edls default body uses payload title", es?.body, "Night Shift");
  const esBlank = await renderInapp(edlsSheetStatusNotifier, {
    sheetId: "abcd1234-0000-0000-0000-000000000000",
    previousStatus: "draft",
    newStatus: "lock",
    title: "",
    ymd: "2026-01-08",
  });
  check(
    "edls blank-title default falls back",
    esBlank?.title,
    "Sheet abcd1234",
  );
  await checkChannels(
    "edls",
    edlsSheetStatusNotifier,
    {
      sheetId: "00000000-0000-0000-0000-000000000000",
      previousStatus: "draft",
      newStatus: "lock",
      title: "Night Shift",
      ymd: "2026-01-08",
    },
    {
      body: 'The EDLS sheet "Night Shift" (2026-01-08) has reached the status "Locked".',
      cta: "View the sheet:",
      path: "/edls/sheet/00000000-0000-0000-0000-000000000000",
    },
  );

  const { dispatchForeNotifier } = await import(
    "../../server/plugins/event-notifier/plugins/dispatch-fore-notifier"
  );
  // Job id points at a DELETED job: names must come from the payload.
  const fs = await renderInapp(dispatchForeNotifier, {
    foreId: "gone",
    jobId: "00000000-0000-0000-0000-000000000000",
    workerId: "00000000-0000-0000-0000-000000000001",
    action: "removed",
    jobTitle: "Old Job Name",
    employerName: "Acme Corp",
  });
  check("fore removed title", fs?.title, "Removed as Foreperson");
  check(
    "fore body uses payload names for deleted job",
    fs?.body,
    'You have been removed as a Foreperson on "Old Job Name" at Acme Corp.',
  );
  await checkChannels(
    "fore",
    dispatchForeNotifier,
    {
      foreId: "gone",
      jobId: "00000000-0000-0000-0000-000000000000",
      workerId: "00000000-0000-0000-0000-000000000001",
      action: "removed",
      jobTitle: "Old Job Name",
      employerName: "Acme Corp",
    },
    {
      body: 'You have been removed as a Foreperson on "Old Job Name" at Acme Corp.',
      cta: "View the job:",
      path: "/dispatch/job/00000000-0000-0000-0000-000000000000",
    },
  );

  const [g] = (
    await db.execute(sql`select id from grievances limit 1`)
  ).rows as { id: string }[];
  if (g) {
    const { grievanceSettlementNotifier } = await import(
      "../../server/plugins/event-notifier/plugins/grievance-settlement-notifier"
    );
    // Delete: row is gone; message must still render from the payload.
    const del = await renderInapp(grievanceSettlementNotifier, {
      grievanceId: g.id,
      settlementId: "00000000-0000-0000-0000-000000000000",
      operation: "deleted",
      amount: "250.00",
    });
    check(
      "settlement delete default body",
      del?.body,
      "A settlement of $250 was removed from the grievance",
    );
    const delPayload = {
      grievanceId: g.id,
      settlementId: "00000000-0000-0000-0000-000000000000",
      operation: "deleted",
      amount: "250.00",
    };
    const delEntity = await (
      grievanceSettlementNotifier as any
    ).tokenTemplates.roots[0].build({ payload: delPayload } as any);
    const gTitle = String(delEntity?.row?.grievanceTitle ?? "");
    await checkChannels(
      "settlement",
      grievanceSettlementNotifier,
      delPayload,
      {
        body: `A settlement of $250 was removed from the grievance ${gTitle}.`,
        cta: "View the settlement:",
        path: `/grievance/${g.id}/settlements`,
      },
    );

    const { grievanceStatusNotifier } = await import(
      "../../server/plugins/event-notifier/plugins/grievance-status-notifier"
    );
    // Status id points at a DELETED/renamed option: name must come from
    // the payload, not a live option lookup.
    const gs = await renderInapp(grievanceStatusNotifier, {
      grievanceId: g.id,
      previousStatusId: null,
      newStatusId: "00000000-0000-0000-0000-000000000000",
      newStatusName: "Old Status Name",
    });
    check(
      "grievance-status body uses payload status name",
      gs?.body,
      'the status "Old Status Name"',
    );
    const gsBlank = await renderInapp(grievanceStatusNotifier, {
      grievanceId: g.id,
      previousStatusId: null,
      newStatusId: "00000000-0000-0000-0000-000000000000",
      newStatusName: "  ",
    });
    check(
      "grievance-status blank name neutral fallback",
      gsBlank?.body,
      'the status "a new status"',
    );
    const gsBody = String(gs?.body ?? "");
    await checkChannels(
      "grievance-status",
      grievanceStatusNotifier,
      {
        grievanceId: g.id,
        previousStatusId: null,
        newStatusId: "00000000-0000-0000-0000-000000000000",
        newStatusName: "Old Status Name",
      },
      {
        body: gsBody,
        cta: "View the grievance:",
        path: `/grievance/${g.id}`,
      },
    );
  } else console.log("SKIP: no grievance row");

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

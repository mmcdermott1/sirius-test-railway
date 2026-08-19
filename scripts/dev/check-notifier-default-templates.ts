/**
 * Regression check: the token-templated notifiers' DEFAULT messages must
 * keep the pre-token display semantics — status display labels
 * ("Not Available", "Locked"), operation-specific settlement prose with
 * formatted currency, and the grievance title fallback chain.
 *
 * A root renders the record as the EVENT carried it, so a row that is
 * edited or deleted between the event and delivery neither rewrites nor
 * swallows the message (a removed foreperson membership and a deleted
 * settlement have no row left at all). The one exception is the grievance
 * status notifier, whose subject is an immutable history entry it loads by
 * id: if that entry is gone, the message has nothing truthful left to say.
 *
 * Run: npx tsx scripts/dev/check-notifier-default-templates.ts
 */
import { storage } from "../../server/storage/database";
import { loadComponentCache } from "../../server/services/component-cache";
import { db } from "../../server/storage/db";
import { eq, sql } from "drizzle-orm";

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
  // The notifier renders the availability row the EVENT carried, so the
  // check needs a real one to snapshot; every field it offers is a column
  // of that row.
  const { workerDispatchStatus } = await import(
    "../../shared/schema/dispatch/schema"
  );
  const [wds] = await db.select().from(workerDispatchStatus).limit(1);
  if (wds) {
    const dsPayload = {
      statusId: wds.id,
      workerId: wds.workerId,
      status: wds.status,
      row: wds,
      previousStatus: null,
    };
    const ds = await renderInapp(dispatchStatusNotifier, dsPayload);
    const dsLabel = dispatchStatusLabel(wds.status);
    check(
      "dispatch-status default body",
      ds?.body,
      `Your dispatch status is now ${dsLabel}.`,
    );
    await checkChannels("dispatch-status", dispatchStatusNotifier, dsPayload, {
      body: `Your dispatch status is now ${dsLabel}.`,
      cta: "View your dispatch page:",
      path: `/workers/${wds.workerId}/dispatch/status`,
    });
    // A later write must not rewrite the transition this event earned: the
    // message describes the row the event carried, even when no such row
    // exists any more.
    const dsStale = await renderInapp(dispatchStatusNotifier, {
      ...dsPayload,
      statusId: "00000000-0000-0000-0000-000000000000",
      row: {
        ...wds,
        id: "00000000-0000-0000-0000-000000000000",
        status: "not_available",
      },
    });
    check(
      "dispatch-status renders the event's row, not the live one",
      dsStale?.body,
      "Your dispatch status is now Not Available.",
    );
  } else console.log("SKIP: no worker dispatch status row");

  const { edlsSheetStatusNotifier } = await import(
    "../../server/plugins/event-notifier/plugins/edls-sheet-status-notifier"
  );
  // The sheet the event carried; only the columns the default templates
  // name matter here (coverage of the rest is the root-fields check's job).
  const edlsSheet = (id: string, title: string) =>
    ({ id, title, ymd: "2026-01-08", status: "lock" }) as never;
  const es = await renderInapp(edlsSheetStatusNotifier, {
    sheetId: "00000000-0000-0000-0000-000000000000",
    previousStatus: "draft",
    newStatus: "lock",
    sheet: edlsSheet("00000000-0000-0000-0000-000000000000", "Night Shift"),
  });
  check("edls default body uses label", es?.body, 'the status "Locked"');
  check("edls default body uses the event's title", es?.body, "Night Shift");
  const esBlank = await renderInapp(edlsSheetStatusNotifier, {
    sheetId: "abcd1234-0000-0000-0000-000000000000",
    previousStatus: "draft",
    newStatus: "lock",
    sheet: edlsSheet("abcd1234-0000-0000-0000-000000000000", ""),
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
      sheet: edlsSheet("00000000-0000-0000-0000-000000000000", "Night Shift"),
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
  // Both records ride on the event: the membership row is deliberately
  // gone for a removal, and the job is a record of its own, so its title
  // and employer are read off the job instead of copied onto the
  // membership. The employer NAME still comes from a live FK lookup, so
  // the job needs a real employer.
  const { dispatchJobs } = await import("../../shared/schema/dispatch/schema");
  const { employers } = await import("../../shared/schema");
  const [jobRow] = await db
    .select({ job: dispatchJobs, employerName: employers.name })
    .from(dispatchJobs)
    .innerJoin(employers, eq(dispatchJobs.employerId, employers.id))
    .limit(1);
  if (jobRow) {
    const job = jobRow.job;
    const forePayload = {
      foreId: "gone",
      jobId: job.id,
      workerId: "00000000-0000-0000-0000-000000000001",
      action: "removed",
      fore: {
        id: "gone",
        jobId: job.id,
        workerId: "00000000-0000-0000-0000-000000000001",
      } as never,
      job,
    };
    const fs = await renderInapp(dispatchForeNotifier, forePayload);
    const foreBody =
      `You have been removed as a Foreperson on "${job.title}" ` +
      `at ${jobRow.employerName}.`;
    check("fore removed title", fs?.title, "Removed as Foreperson");
    check("fore body names the job and its employer", fs?.body, foreBody);
    await checkChannels("fore", dispatchForeNotifier, forePayload, {
      body: foreBody,
      cta: "View the job:",
      path: `/dispatch/job/${job.id}`,
    });
    // Deleting the job right after the removal must not swallow the
    // notice: it describes the job as the event carried it.
    const foreStale = await renderInapp(dispatchForeNotifier, {
      ...forePayload,
      jobId: "00000000-0000-0000-0000-000000000000",
      job: { ...job, id: "00000000-0000-0000-0000-000000000000" },
    });
    check(
      "fore renders a job that no longer exists",
      foreStale?.body,
      `removed as a Foreperson on "${job.title}"`,
    );
  } else console.log("SKIP: no dispatch job with an employer");

  const { grievances } = await import("../../shared/schema");
  const [g] = await db.select().from(grievances).limit(1);
  if (g) {
    const gRow = g;
    const gTitleInfo = await storage.grievances.getAssignmentTitleInfo(g.id);
    const { grievanceSettlementNotifier } = await import(
      "../../server/plugins/event-notifier/plugins/grievance-settlement-notifier"
    );
    // Delete: the row is gone from the table, so the message renders from
    // the copy the event carried.
    const deletedRow = {
      id: "00000000-0000-0000-0000-000000000000",
      grievanceId: g.id,
      description: null,
      amount: "250.00",
      typeIds: [],
    } as never;
    const delPayload = {
      grievanceId: g.id,
      settlementId: "00000000-0000-0000-0000-000000000000",
      operation: "deleted",
      row: deletedRow,
      grievance: gRow,
      grievanceTitleParts: gTitleInfo
        ? { name: gTitleInfo.name, categoryName: gTitleInfo.categoryName }
        : null,
    };
    const del = await renderInapp(grievanceSettlementNotifier, delPayload);
    check(
      "settlement delete default body",
      del?.body,
      "A settlement of $250 was removed from the grievance",
    );
    // The title is the GRIEVANCE's, not a field of the settlement.
    const gTitle = composeGrievanceDisplayTitle(g.id, gTitleInfo);
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
    // This notifier renders the REAL status-history row the event names, so
    // it needs one to exist. Unlike the payload-snapshot notifiers above,
    // every field it offers is a column of that row.
    const [entry] = (
      await db.execute(sql`
        select h.id, h.grievance_id, o.name as status_name
        from grievance_status_history h
        left join options_grievance_status o on o.id = h.status_id
        where o.name is not null
        limit 1
      `)
    ).rows as { id: string; grievance_id: string; status_name: string }[];
    if (entry) {
      const titleInfo = await storage.grievances.getAssignmentTitleInfo(
        entry.grievance_id,
      );
      const title = composeGrievanceDisplayTitle(entry.grievance_id, titleInfo);
      const payload = {
        grievanceId: entry.grievance_id,
        previousStatusId: null,
        previousStatusName: null,
        newStatusId: null,
        newStatusName: null,
        newStatusHistoryId: entry.id,
      };
      const gs = await renderInapp(grievanceStatusNotifier, payload);
      // The status FK renders the option's live name; the notifier no longer
      // carries a denormalised copy of it.
      check(
        "grievance-status body renders the entry's status",
        gs?.body,
        `the status "${entry.status_name}"`,
      );
      check("grievance-status body names the grievance", gs?.body, title);
      const body = `The grievance "${title}" has reached the status "${entry.status_name}".`;
      await checkChannels("grievance-status", grievanceStatusNotifier, payload, {
        body,
        cta: "View the grievance:",
        path: `/grievance/${entry.grievance_id}`,
      });
      // The entry is what the message is ABOUT: if it's gone by delivery
      // time there is nothing truthful left to say, so nothing is sent.
      const gone = await renderInapp(grievanceStatusNotifier, {
        ...payload,
        newStatusHistoryId: "00000000-0000-0000-0000-000000000000",
      });
      console.log(
        gone === null
          ? "PASS: grievance-status skips when the status entry is gone"
          : "FAIL: grievance-status still rendered without its status entry",
      );
      if (gone !== null) failures++;
    } else console.log("SKIP: no grievance status history row");
  } else console.log("SKIP: no grievance row");

  // --- persona previews: one pick, a visibly different message ---
  // A studio preview of a notifier's DEFAULTS with no record picked
  // renders the named personas. If a default template happens to use only
  // fields no persona names, every persona renders the same sentence and
  // the picker looks broken. Every converted notifier must render
  // differently under each persona — and the system values in it (this
  // site's address, today's date) must be REAL even in that all-sample
  // render, so the author can click the link they wrote.
  const { renderTokens, createTokenEvalContext } = await import(
    "../../server/plugins/tokens"
  );
  const { listSampleSetDeclarations } = await import(
    "../../server/plugins/tokens/sample-sets"
  );
  const { absoluteBaseUrl } = await import("../../server/lib/base-url");
  const { listTokenPreviewRoots, ordinaryPreviewRootNames } = await import(
    "../../server/plugins/tokens/preview-roots"
  );
  const { EVENT_ROOT_NAME } = await import(
    "../../server/plugins/tokens/plugins/event"
  );
  const personaIds = Array.from(
    new Set(
      listSampleSetDeclarations().flatMap(({ sets }) =>
        sets.map((set) => set.id),
      ),
    ),
  );

  /** Render one channel's default templates with no record picked. */
  async function renderPersona(
    plugin: any,
    channel: "inapp" | "email",
    personaId: string,
  ): Promise<string> {
    const templates = resolveTemplates(plugin, {})[channel] ?? {};
    const cache = new Map<string, unknown>();
    const parts: string[] = [];
    // The persona is chosen per ROOT, so rendering a whole template as
    // one persona means naming it for every root the notifier's
    // templates can address — the notifier's own, the event envelope,
    // and the recipient-side roots a template may reach for even though
    // the studio does not offer them as separate seeds.
    const rootNames: string[] = [
      ...(plugin.tokenTemplates?.roots ?? []).map((root: any) => root.name),
      EVENT_ROOT_NAME,
      ...ordinaryPreviewRootNames(),
    ];
    const sampleSetIds: Record<string, string> = {};
    for (const root of listTokenPreviewRoots(rootNames)) {
      sampleSetIds[root.name] = personaId;
    }
    for (const value of Object.values(templates)) {
      if (typeof value !== "string") continue;
      const ctx = createTokenEvalContext(storage, undefined, {
        sample: true,
        sampleSetIds,
        cache,
      });
      parts.push((await renderTokens(value, ctx)).output);
    }
    return parts.join("\n");
  }

  const converted: Array<[string, any]> = [
    ["dispatch-status", dispatchStatusNotifier],
    ["fore", dispatchForeNotifier],
    ["edls", edlsSheetStatusNotifier],
  ];
  const { grievanceStatusNotifier: gsn } = await import(
    "../../server/plugins/event-notifier/plugins/grievance-status-notifier"
  );
  const { grievanceSettlementNotifier: gsettle } = await import(
    "../../server/plugins/event-notifier/plugins/grievance-settlement-notifier"
  );
  converted.push(["grievance-status", gsn], ["settlement", gsettle]);

  for (const [label, plugin] of converted) {
    const seen = new Map<string, string>();
    for (const personaId of personaIds) {
      const rendered = await renderPersona(plugin, "inapp", personaId);
      const clash = Array.from(seen.entries()).find(
        ([, text]) => text === rendered,
      );
      const ok = rendered.trim() !== "" && !clash;
      console.log(
        `${ok ? "PASS" : "FAIL"}: ${label} persona "${personaId}" renders its own message`,
      );
      if (!ok) {
        failures++;
        console.log(
          clash
            ? `  identical to persona "${clash[0]}": ${rendered}`
            : "  rendered nothing",
        );
      }
      seen.set(personaId, rendered);
    }
    // System values are not sampled: an all-sample preview still links to
    // this deployment.
    const email = await renderPersona(plugin, "email", personaIds[0]);
    if (email.includes("http")) {
      check(`${label} sample preview links to the real site`, email, absoluteBaseUrl());
    }
  }

  console.log(failures === 0 ? "\nALL CHECKS PASSED" : `\n${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

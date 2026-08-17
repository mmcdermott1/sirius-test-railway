import { workers, employers, dispatchJobs } from "@shared/schema";
import { workerDispatchStatus } from "../../../../shared/schema/dispatch/schema";
import { dispatchJobFore } from "../../../../shared/schema/dispatch/fore-schema";
import { WORKER_EXTRA_FIELDS } from "../../../storage/bulk/tokens";
import { registerTokenPlugin } from "../registry";
import { memo, tokenEntityOf, type TokenEntity } from "../types";

/**
 * Named sample dispatch jobs, one per shared persona id. Values are obviously
 * fictional: a preview must never be mistaken for a real dispatch record.
 */
const DISPATCH_JOB_SAMPLE_SETS = [
  {
    id: "martian",
    label: "Martian",
    values: {
      title: "Regolith Collection — Sector 7",
      description: "Loading and hauling regolith from the Sector 7 extraction zone",
      status: "open",
      start_ymd: "2031-03-14",
      worker_count: "12",
      pay_rate: "45.00",
    },
  },
  {
    id: "historical",
    label: "Historical",
    values: {
      title: "Analytical Engine Shift — Menabrea Hall",
      description: "Operating and maintaining the analytical engine during scheduled computation sessions",
      status: "open",
      start_ymd: "1843-12-10",
      worker_count: "6",
      pay_rate: "22.50",
    },
  },
  {
    id: "mythological",
    label: "Mythological",
    values: {
      title: "Voyage Crew — Ithaka Fleet",
      description: "Navigation and seamanship duties for the return fleet voyage",
      status: "in_progress",
      start_ymd: "1184-03-02",
      worker_count: "20",
      pay_rate: "18.00",
    },
  },
];

// Persona ids match the worker/contact sets, so one pick tells one coherent
// story. Every field the notifier's DEFAULT templates render is named here —
// including the derived `status_label` and the `worker_id` the default link
// path uses — so switching persona visibly changes the preview instead of
// re-rendering the same sentence.
const DISPATCH_WORKER_STATUS_SAMPLE_SETS = [
  {
    id: "martian",
    label: "Martian",
    values: {
      worker_id: "SAMPLE-W001",
      status: "available",
      status_label: "Available",
      seniority_date: "January 1, 2028",
    },
  },
  {
    id: "historical",
    label: "Historical",
    values: {
      worker_id: "SAMPLE-W002",
      status: "not_available",
      status_label: "Not Available",
      seniority_date: "January 1, 1840",
    },
  },
  {
    id: "mythological",
    label: "Mythological",
    values: {
      worker_id: "SAMPLE-W003",
      status: "available",
      status_label: "Available",
      seniority_date: "January 1, 1180",
    },
  },
];

// Job titles and employers mirror the dispatch-job/employer personas, so a
// foreperson preview and a job preview tell the same story.
const DISPATCH_FORE_SAMPLE_SETS = [
  {
    id: "martian",
    label: "Martian",
    values: {
      job_id: "SAMPLE-J001",
      action: "added",
      action_label: "Added",
      job_title: "Regolith Collection — Sector 7",
      employer_name: "Olympus Mons Freight",
    },
  },
  {
    id: "historical",
    label: "Historical",
    values: {
      job_id: "SAMPLE-J002",
      action: "added",
      action_label: "Added",
      job_title: "Analytical Engine Shift — Menabrea Hall",
      employer_name: "Difference Engine Works",
    },
  },
  {
    id: "mythological",
    label: "Mythological",
    values: {
      job_id: "SAMPLE-J003",
      action: "removed",
      action_label: "Removed",
      job_title: "Voyage Crew — Ithaka Fleet",
      employer_name: "Ithaka Shipping Company",
    },
  },
];

/**
 * Token plugins for the dispatch entity kinds, used by the
 * token-templated dispatch notifiers:
 *   - `dispatch_job` — a dispatch job row (descriptor; the T631
 *     interview relation already outputs this kind, but the descriptor
 *     keeps the kind's field catalog independent of the T631 component).
 *   - `dispatch_worker_status` — a worker's dispatch availability row.
 *   - `dispatch_fore` — a job-foreperson membership; the notifier
 *     merges the event's `action` (added/removed) onto the row.
 */
export const DISPATCH_JOB_ENTITY_KIND = "dispatch_job";
export const DISPATCH_WORKER_STATUS_ENTITY_KIND = "dispatch_worker_status";
export const DISPATCH_FORE_ENTITY_KIND = "dispatch_fore";

const COMPONENT = "dispatch";

/** Dispatch job descriptor (FK employer_id auto-renders the employer name). */
registerTokenPlugin({
  metadata: {
    id: "token.dispatch_job",
    name: "Dispatch job",
    description: "Descriptor for the dispatch job entity kind",
    segmentName: "__dispatch_job",
    inputTypes: [],
    outputType: DISPATCH_JOB_ENTITY_KIND,
    entityTable: dispatchJobs,
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
    defaultLeaf: "title",
    // A few real dispatch jobs a surface may OFFER as preview subjects
    // (there is no search and no load-by-id — a template author is not
    // entitled to name an arbitrary record). Gated on the dispatch
    // component (inherited from the plugin): the job tables need not
    // exist at all when it is off.
    recentRecords: {
      async recent(limit) {
        const { storage } = await import("../../../storage");
        const jobs = await storage.dispatchJobs.getAll();
        return jobs.slice(0, limit).map((j) => ({
          id: j.id,
          label: `${j.title} — ${j.startYmd}`,
          entity: {
            kind: DISPATCH_JOB_ENTITY_KIND,
            row: j as unknown as Record<string, unknown>,
            table: dispatchJobs,
          },
        }));
      },
    },
    sampleSets: DISPATCH_JOB_SAMPLE_SETS,
  },
  async resolve(entity, _args, ctx) {
    const e = tokenEntityOf(entity, DISPATCH_FORE_ENTITY_KIND);
    const jobId = e?.row.jobId;
    if (typeof jobId !== "string") return null;
    const row = await memo(ctx, `dispatch-job-row:${jobId}`, async () => {
      return (await ctx.storage.dispatchJobs.get(jobId)) ?? null;
    });
    if (!row) return null;
    const out: TokenEntity = {
      kind: DISPATCH_JOB_ENTITY_KIND,
      row: row as unknown as Record<string, unknown>,
      table: dispatchJobs,
    };
    return out;
  },
});

/** {{event.dispatch_job.field(name="…")}} — the fore membership's job. */
registerTokenPlugin({
  metadata: {
    id: "token.dispatch_fore.dispatch_job",
    name: "Dispatch job",
    description: "The dispatch job this foreperson record belongs to",
    segmentName: "dispatch_job",
    inputTypes: [DISPATCH_FORE_ENTITY_KIND],
    outputType: DISPATCH_JOB_ENTITY_KIND,
    entityTable: dispatchJobs,
    hiddenFromCatalog: true,
    requiredComponent: "dispatch.fore",
  },
  async resolve(entity, _args, ctx) {
    const e = tokenEntityOf(entity, DISPATCH_FORE_ENTITY_KIND);
    const jobId = e?.row.jobId;
    if (typeof jobId !== "string") return null;
    const row = await memo(ctx, `dispatch-job-row:${jobId}`, async () => {
      return (await ctx.storage.dispatchJobs.get(jobId)) ?? null;
    });
    if (!row) return null;
    const out: TokenEntity = {
      kind: DISPATCH_JOB_ENTITY_KIND,
      row: row as unknown as Record<string, unknown>,
      table: dispatchJobs,
    };
    return out;
  },
});

/**
 * Dispatch worker status descriptor — a worker's dispatch availability row.
 * `action` is a derived extra the notifier merges onto the row.
 */
registerTokenPlugin({
  metadata: {
    id: "token.dispatch_worker_status",
    name: "Dispatch worker status",
    description: "Descriptor for the dispatch worker availability entity kind",
    segmentName: "__dispatch_worker_status",
    inputTypes: [],
    outputType: DISPATCH_WORKER_STATUS_ENTITY_KIND,
    entityTable: workerDispatchStatus,
    // `status_label` is derived, not a column: the notifier merges it onto
    // the row and the recent-record provider below computes the same way.
    entityFields: ["status_label"],
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
    sampleSets: DISPATCH_WORKER_STATUS_SAMPLE_SETS,
    // A few real dispatch-status rows a surface may OFFER as preview
    // subjects (no search, no load-by-id — a template author is not
    // entitled to name an arbitrary record). Rows carry the same derived
    // `status_label` the notifier merges on, so a preview against a real
    // record renders exactly what delivery would.
    recentRecords: {
      async recent(limit) {
        const [{ createWorkerDispatchStatusStorage }, { dispatchStatusLabel }] =
          await Promise.all([
            import("../../../storage/dispatch/worker-status"),
            import(
              "../../event-notifier/plugins/dispatch-status-notifier"
            ),
          ]);
        const rows =
          await createWorkerDispatchStatusStorage().listForPreview(limit);
        return rows.map((row) => ({
          id: row.id,
          label: `${row.workerName || "Unnamed worker"} — ${dispatchStatusLabel(row.status)}`,
          entity: {
            kind: DISPATCH_WORKER_STATUS_ENTITY_KIND,
            row: {
              id: row.id,
              workerId: row.workerId,
              status: row.status,
              seniorityDate: row.seniorityDate,
              statusLabel: dispatchStatusLabel(row.status),
            },
            table: workerDispatchStatus,
          },
        }));
      },
    },
  },
  async resolve() {
    return null;
  },
});

/**
 * {{dispatch.worker.…}} — the worker whose availability row this is.
 * Reaches the worker's contact (and from there their address, phone,
 * …), so a status message can name the person it is about.
 */
registerTokenPlugin({
  metadata: {
    id: "token.dispatch_worker_status.worker",
    name: "Worker",
    description: "The worker this dispatch status belongs to",
    segmentName: "worker",
    inputTypes: [DISPATCH_WORKER_STATUS_ENTITY_KIND],
    outputType: "worker",
    entityTable: workers,
    entityFields: WORKER_EXTRA_FIELDS,
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
  },
  async resolve(entity, _args, ctx) {
    const e = tokenEntityOf(entity, DISPATCH_WORKER_STATUS_ENTITY_KIND);
    const workerId = e?.row.workerId;
    if (typeof workerId !== "string") return null;
    const row = await memo(ctx, `worker-row-by-id:${workerId}`, async () => {
      return (await ctx.storage.bulkTokens.getWorkerRowById(workerId)) ?? null;
    });
    if (!row) return null;
    const out: TokenEntity = { kind: "worker", row, table: workers };
    return out;
  },
});

/** {{dispatch_fore.worker.…}} — the foreperson the membership is for. */
registerTokenPlugin({
  metadata: {
    id: "token.dispatch_fore.worker",
    name: "Worker",
    description: "The worker named as foreperson",
    segmentName: "worker",
    inputTypes: [DISPATCH_FORE_ENTITY_KIND],
    outputType: "worker",
    entityTable: workers,
    entityFields: WORKER_EXTRA_FIELDS,
    hiddenFromCatalog: true,
    requiredComponent: "dispatch.fore",
  },
  async resolve(entity, _args, ctx) {
    const e = tokenEntityOf(entity, DISPATCH_FORE_ENTITY_KIND);
    const workerId = e?.row.workerId;
    if (typeof workerId !== "string") return null;
    const row = await memo(ctx, `worker-row-by-id:${workerId}`, async () => {
      return (await ctx.storage.bulkTokens.getWorkerRowById(workerId)) ?? null;
    });
    if (!row) return null;
    const out: TokenEntity = { kind: "worker", row, table: workers };
    return out;
  },
});

/**
 * Dispatch fore descriptor — a job-foreperson membership row. `action`
 * (added/removed) is a derived extra the notifier merges onto the row.
 */
registerTokenPlugin({
  metadata: {
    id: "token.dispatch_fore",
    name: "Dispatch foreperson",
    description: "Descriptor for the dispatch foreperson membership entity kind",
    segmentName: "__dispatch_fore",
    inputTypes: [],
    outputType: DISPATCH_FORE_ENTITY_KIND,
    entityTable: dispatchJobFore,
    // Derived extras, not columns: the notifier merges these onto the row
    // (and the recent-record provider below composes the same ones).
    entityFields: ["action", "action_label", "job_title", "employer_name"],
    hiddenFromCatalog: true,
    requiredComponent: "dispatch.fore",
    sampleSets: DISPATCH_FORE_SAMPLE_SETS,
    // A few real foreperson rows a surface may OFFER as preview subjects.
    // A membership that exists was added, so the derived `action` reads
    // "added"; the removal wording is covered by the personas.
    recentRecords: {
      async recent(limit) {
        const { storage } = await import("../../../storage");
        const rows = await storage.dispatchJobFore.listForPreview(limit);
        return rows.map((row) => ({
          id: row.id,
          label: [
            row.workerName || "Unnamed worker",
            row.jobTitle || "Untitled job",
            row.employerName || null,
          ]
            .filter(Boolean)
            .join(" — "),
          entity: {
            kind: DISPATCH_FORE_ENTITY_KIND,
            row: {
              id: row.id,
              jobId: row.jobId,
              workerId: row.workerId,
              data: row.data,
              action: "added",
              actionLabel: "Added",
              jobTitle: row.jobTitle,
              employerName: row.employerName,
            },
            table: dispatchJobFore,
          },
        }));
      },
    },
  },
  async resolve() {
    return null;
  },
});


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

// Persona ids match the worker/contact sets, so one pick tells one coherent story.
const DISPATCH_WORKER_STATUS_SAMPLE_SETS = [
  {
    id: "martian",
    label: "Martian",
    values: { status: "available", seniority_date: "January 1, 2028" },
  },
  {
    id: "historical",
    label: "Historical",
    values: { status: "available", seniority_date: "January 1, 1840" },
  },
  {
    id: "mythological",
    label: "Mythological",
    values: { status: "not_available", seniority_date: "January 1, 1180" },
  },
];

const DISPATCH_FORE_SAMPLE_SETS = [
  { id: "martian", label: "Martian", values: { action: "added" } },
  { id: "historical", label: "Historical", values: { action: "added" } },
  { id: "mythological", label: "Mythological", values: { action: "removed" } },
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
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
    sampleSets: DISPATCH_WORKER_STATUS_SAMPLE_SETS,
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
    entityFields: ["action"],
    hiddenFromCatalog: true,
    requiredComponent: "dispatch.fore",
    sampleSets: DISPATCH_FORE_SAMPLE_SETS,
  },
  async resolve() {
    return null;
  },
});


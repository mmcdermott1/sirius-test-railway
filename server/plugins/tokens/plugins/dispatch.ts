import { workers, employers, dispatchJobs } from "@shared/schema";
import { workerDispatchStatus } from "../../../../shared/schema/dispatch/schema";
import { dispatchJobFore } from "../../../../shared/schema/dispatch/fore-schema";
import { WORKER_EXTRA_FIELDS } from "../../../storage/bulk/tokens";
import { registerTokenPlugin } from "../registry";
import { memo, tokenEntityOf, type TokenEntity } from "../types";

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
  },
  async resolve() {
    return null;
  },
});

/** {{event.…dispatch_job.employer.field(name="…")}} — the job's employer. */
registerTokenPlugin({
  metadata: {
    id: "token.dispatch_job.employer",
    name: "Job employer",
    description: "The employer the dispatch job belongs to",
    segmentName: "employer",
    inputTypes: [DISPATCH_JOB_ENTITY_KIND],
    outputType: "employer",
    entityTable: employers,
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
  },
  async resolve(entity, _args, ctx) {
    const e = tokenEntityOf(entity, DISPATCH_JOB_ENTITY_KIND);
    const employerId = e?.row.employerId;
    if (typeof employerId !== "string") return null;
    const row = await memo(ctx, `employer-row:${employerId}`, async () => {
      return (await ctx.storage.bulkTokens.getEmployerRow(employerId)) ?? null;
    });
    if (!row) return null;
    const out: TokenEntity = { kind: "employer", row, table: employers };
    return out;
  },
});

/** Worker dispatch-status descriptor. */
registerTokenPlugin({
  metadata: {
    id: "token.dispatch_worker_status",
    name: "Dispatch status",
    description: "Descriptor for the worker dispatch-status entity kind",
    segmentName: "__dispatch_worker_status",
    inputTypes: [],
    outputType: DISPATCH_WORKER_STATUS_ENTITY_KIND,
    entityTable: workerDispatchStatus,
    entityFields: ["status_label"],
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
  },
  async resolve() {
    return null;
  },
});

/**
 * Fore-membership descriptor. `action` is a derived extra: the
 * foreperson notifier merges the event's action (added/removed) onto
 * the row, so templates can say `{{event.field(name="action")}}`.
 */
registerTokenPlugin({
  metadata: {
    id: "token.dispatch_fore",
    name: "Job foreperson",
    description: "Descriptor for the dispatch job-foreperson entity kind",
    segmentName: "__dispatch_fore",
    inputTypes: [],
    outputType: DISPATCH_FORE_ENTITY_KIND,
    entityTable: dispatchJobFore,
    entityFields: ["action", "action_label", "job_title", "employer_name"],
    hiddenFromCatalog: true,
    requiredComponent: "dispatch.fore",
  },
  async resolve() {
    return null;
  },
});

/** {{event.worker.field(name="…")}} — the record's worker. */
registerTokenPlugin({
  metadata: {
    id: "token.dispatch_relation.worker",
    name: "Worker",
    description: "The worker this record belongs to",
    segmentName: "worker",
    inputTypes: [DISPATCH_WORKER_STATUS_ENTITY_KIND, DISPATCH_FORE_ENTITY_KIND],
    outputType: "worker",
    entityTable: workers,
    entityFields: WORKER_EXTRA_FIELDS,
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
  },
  async resolve(entity, _args, ctx) {
    const e =
      tokenEntityOf(entity, DISPATCH_WORKER_STATUS_ENTITY_KIND) ??
      tokenEntityOf(entity, DISPATCH_FORE_ENTITY_KIND);
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

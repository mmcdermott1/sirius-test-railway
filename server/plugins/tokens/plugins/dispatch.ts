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


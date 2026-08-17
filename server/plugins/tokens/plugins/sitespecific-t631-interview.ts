import { workers, dispatchJobs } from "@shared/schema";
import { sitespecificT631JobInterviews } from "../../../../shared/schema/sitespecific/t631/interviews-schema";
import { WORKER_EXTRA_FIELDS } from "../../../storage/bulk/tokens";
import { registerTokenPlugin } from "../registry";
import { memo, tokenEntityOf, type TokenEntity } from "../types";

/**
 * Token plugins for the T631 job-interview entity kind, used by the
 * token-templated T631 interview notifier: `{{event.field(name="status")}}`,
 * `{{event.worker.field(name="…")}}`, `{{event.dispatch_job.field(name="…")}}`.
 * All gated on the interviews component.
 */
const COMPONENT = "sitespecific.t631.interviews";
export const T631_INTERVIEW_ENTITY_KIND = "sitespecific_t631_interview";

/** Human label for an interview status value ("offered" → "Offered"). */
function previewStatusLabel(status: string): string {
  if (!status) return status;
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * Entity descriptor: never matches as a segment (`inputTypes: []`) —
 * it exists so the field catalog derives the interview kind's valid
 * `field(name=…)` names from the live Drizzle schema.
 */
registerTokenPlugin({
  metadata: {
    id: "token.sitespecific_t631_interview",
    name: "T631 interview",
    description: "Descriptor for the T631 job-interview entity kind",
    segmentName: "__sitespecific_t631_interview",
    inputTypes: [],
    outputType: T631_INTERVIEW_ENTITY_KIND,
    entityTable: sitespecificT631JobInterviews,
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
    // Real-record preview: any template editor rooted at the interview
    // kind (notifier Template Studio, generic token studio) can search
    // and load real interviews. Declared once with the entity kind,
    // never per surface; gated on the interviews component.
    previewEntities: {
      async search(query) {
        const { storage } = await import("../../../storage");
        const rows = await storage.t631Interviews.searchForPicker(query);
        return rows.map((r) => ({
          id: r.id,
          label: `${r.workerName ?? "Unknown worker"} — ${r.jobTitle} (${previewStatusLabel(r.status)})`,
        }));
      },
      async load(id) {
        const { storage } = await import("../../../storage");
        const row = await storage.t631Interviews.get(id);
        if (!row) return null;
        return {
          kind: T631_INTERVIEW_ENTITY_KIND,
          row: row as unknown as Record<string, unknown>,
          table: sitespecificT631JobInterviews,
        };
      },
    },
  },
  async resolve() {
    return null;
  },
});

/** {{event.worker.field(name="…")}} — the interview's worker. */
registerTokenPlugin({
  metadata: {
    id: "token.sitespecific_t631_interview.worker",
    name: "Interview worker",
    description: "The worker the interview is for",
    segmentName: "worker",
    inputTypes: [T631_INTERVIEW_ENTITY_KIND],
    outputType: "worker",
    entityTable: workers,
    entityFields: WORKER_EXTRA_FIELDS,
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
  },
  async resolve(entity, _args, ctx) {
    const e = tokenEntityOf(entity, T631_INTERVIEW_ENTITY_KIND);
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

/** {{event.dispatch_job.field(name="…")}} — the interview's dispatch job. */
registerTokenPlugin({
  metadata: {
    id: "token.sitespecific_t631_interview.dispatch_job",
    name: "Interview dispatch job",
    description: "The dispatch job the interview is for",
    segmentName: "dispatch_job",
    inputTypes: [T631_INTERVIEW_ENTITY_KIND],
    outputType: "dispatch_job",
    entityTable: dispatchJobs,
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
  },
  async resolve(entity, _args, ctx) {
    const e = tokenEntityOf(entity, T631_INTERVIEW_ENTITY_KIND);
    const jobId = e?.row.jobId;
    if (typeof jobId !== "string") return null;
    const row = await memo(ctx, `dispatch-job-row:${jobId}`, async () => {
      return (await ctx.storage.dispatchJobs.get(jobId)) ?? null;
    });
    if (!row) return null;
    const out: TokenEntity = {
      kind: "dispatch_job",
      row: row as unknown as Record<string, unknown>,
      table: dispatchJobs,
    };
    return out;
  },
});


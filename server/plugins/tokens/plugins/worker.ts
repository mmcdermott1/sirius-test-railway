import { registerTokenPlugin } from "../registry";
import { memo, type WorkerEntity, type TokenEvalContext } from "../types";
import { fmtDateShort } from "../php-date";
import { loadContact } from "./contact";

async function loadWorker(
  ctx: TokenEvalContext,
  contactId: string,
): Promise<WorkerEntity["worker"] | null> {
  return memo(ctx, `worker:${contactId}`, async () => {
    const row = await ctx.storage.bulkTokens.getWorkerByContactId(contactId);
    return row ?? null;
  });
}

export { loadWorker };

function workerOf(entity: unknown): WorkerEntity | null {
  const e = entity as WorkerEntity | null;
  return e?.kind === "worker" ? e : null;
}

function titleCase(s: string | null | undefined): string {
  if (!s) return "";
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}

/** Root: {{worker...}} — the recipient's worker record (with contact). */
registerTokenPlugin({
  metadata: {
    id: "token.worker",
    name: "Worker",
    description: "The recipient's worker record",
    segmentName: "worker",
    inputTypes: ["root"],
    outputType: "worker",
  },
  async resolve(_entity, _args, ctx) {
    if (!ctx.contactId) return null;
    const worker = await loadWorker(ctx, ctx.contactId);
    if (!worker) return null;
    const contact = await loadContact(ctx, ctx.contactId);
    const entity: WorkerEntity = { kind: "worker", worker, contact };
    return entity;
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.jobTitle",
    name: "Job title",
    shortLabel: "job title",
    description: "Most recent job title on the worker",
    segmentName: "jobTitle",
    inputTypes: ["worker"],
    outputType: "value",
    example: "Lead Carpenter",
  },
  async resolve(entity) {
    return workerOf(entity)?.worker.jobTitle ?? null;
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.siriusId",
    name: "Worker ID",
    shortLabel: "ID",
    description: "Sirius worker ID number",
    segmentName: "siriusId",
    inputTypes: ["worker"],
    outputType: "value",
    example: "10241",
  },
  async resolve(entity) {
    const id = workerOf(entity)?.worker.siriusId;
    return id == null ? null : String(id);
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.workStatus",
    name: "Work status",
    shortLabel: "work status",
    description: "Current work status (e.g. Active, Out-of-Work)",
    segmentName: "workStatus",
    inputTypes: ["worker"],
    outputType: "value",
    example: "Active",
  },
  async resolve(entity, _args, ctx) {
    const wsId = workerOf(entity)?.worker.wsId;
    if (!wsId) return null;
    return memo(ctx, `ws-name:${wsId}`, () =>
      ctx.storage.bulkTokens.getWorkStatusName(wsId),
    );
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.memberStatus",
    name: "Member status",
    shortLabel: "member status",
    description: "Member status (multiple values joined with /)",
    segmentName: "memberStatus",
    inputTypes: ["worker"],
    outputType: "value",
    example: "In Good Standing",
  },
  async resolve(entity, _args, ctx) {
    const msIds = workerOf(entity)?.worker.msIds;
    if (!msIds || msIds.length === 0) return null;
    const names = await memo(ctx, `ms-names:${[...msIds].sort().join(",")}`, () =>
      ctx.storage.bulkTokens.getMemberStatusNames(msIds),
    );
    return names.length > 0 ? names.join(" / ") : null;
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.bargainingUnit",
    name: "Bargaining unit",
    shortLabel: "bargaining unit",
    description: "Name of the worker's bargaining unit",
    segmentName: "bargainingUnit",
    inputTypes: ["worker"],
    outputType: "value",
    example: "Local 123",
  },
  async resolve(entity, _args, ctx) {
    const buId = workerOf(entity)?.worker.bargainingUnitId;
    if (!buId) return null;
    return memo(ctx, `bu-name:${buId}`, () =>
      ctx.storage.bulkTokens.getBargainingUnitName(buId),
    );
  },
});

async function latestCardcheck(entity: unknown, ctx: TokenEvalContext) {
  const w = workerOf(entity)?.worker;
  if (!w) return null;
  return memo(ctx, `cardcheck:${w.id}`, async () => {
    const row = await ctx.storage.bulkTokens.getLatestCardcheckForWorker(w.id);
    return row ?? null;
  });
}

registerTokenPlugin({
  metadata: {
    id: "token.leaf.cardcheckType",
    name: "Cardcheck type",
    shortLabel: "cardcheck type",
    description: "Name of the most recent cardcheck definition for the worker",
    segmentName: "cardcheckType",
    inputTypes: ["worker"],
    outputType: "value",
    example: "Authorization Card",
  },
  async resolve(entity, _args, ctx) {
    return (await latestCardcheck(entity, ctx))?.type ?? null;
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.cardcheckStatus",
    name: "Cardcheck status",
    shortLabel: "cardcheck status",
    description: "Status of the most recent cardcheck (Pending, Signed, Revoked)",
    segmentName: "cardcheckStatus",
    inputTypes: ["worker"],
    outputType: "value",
    example: "Signed",
  },
  async resolve(entity, _args, ctx) {
    return titleCase((await latestCardcheck(entity, ctx))?.status) || null;
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.cardcheckSignedDate",
    name: "Cardcheck signed date",
    shortLabel: "cardcheck signed date",
    description: "Signed date of the most recent cardcheck",
    segmentName: "cardcheckSignedDate",
    inputTypes: ["worker"],
    outputType: "value",
    example: "Apr 17, 2026",
  },
  async resolve(entity, _args, ctx) {
    return fmtDateShort((await latestCardcheck(entity, ctx))?.signedDate) || null;
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.buildingRep",
    name: "Building rep",
    shortLabel: "building rep",
    description: "Steward assigned to this worker's bargaining unit and employer",
    segmentName: "buildingRep",
    inputTypes: ["worker"],
    outputType: "value",
    example: "Jamie Rivera",
  },
  async resolve(entity, _args, ctx) {
    const w = workerOf(entity)?.worker;
    if (!w) return null;
    const employerId = w.homeEmployerId || (w.employerIds && w.employerIds[0]) || null;
    if (!employerId || !w.bargainingUnitId) return null;
    return memo(ctx, `building-rep:${employerId}:${w.bargainingUnitId}:${w.id}`, () =>
      ctx.storage.bulkTokens.getBuildingRepName(employerId, w.bargainingUnitId!, w.id),
    );
  },
});

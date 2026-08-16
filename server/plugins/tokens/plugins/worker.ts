import {
  workers,
  contacts,
  bargainingUnits,
  optionsWorkerWs,
} from "@shared/schema";
import { WORKER_EXTRA_FIELDS } from "../../../storage/bulk/tokens";
import { registerTokenPlugin } from "../registry";
import { memo, tokenEntityOf, type TokenEntity, type TokenEvalContext } from "../types";

export async function loadWorkerEntity(
  ctx: TokenEvalContext,
  contactId: string,
): Promise<TokenEntity | null> {
  const row = await memo(ctx, `worker-row:${contactId}`, async () => {
    return (await ctx.storage.bulkTokens.getWorkerRowByContactId(contactId)) ?? null;
  });
  if (!row) return null;
  return { kind: "worker", row, table: workers };
}

/**
 * Root: {{worker...}} — the recipient's full worker record, plus
 * employment/status denorm extras (job_title, home_employer_id, ws_id,
 * ms_ids, employer_ids).
 */
registerTokenPlugin({
  metadata: {
    id: "token.worker",
    name: "Worker",
    description: "The recipient's worker record",
    segmentName: "worker",
    inputTypes: ["root"],
    outputType: "worker",
    entityTable: workers,
    entityFields: WORKER_EXTRA_FIELDS,
  },
  async resolve(_entity, _args, ctx) {
    if (!ctx.contactId) return null;
    return loadWorkerEntity(ctx, ctx.contactId);
  },
});

/** {{worker.bargaining_unit.field(name="name")}} or short form {{worker.bargaining_unit}} */
registerTokenPlugin({
  metadata: {
    id: "token.worker.bargaining_unit",
    name: "Bargaining unit",
    description: "The worker's bargaining unit",
    segmentName: "bargaining_unit",
    inputTypes: ["worker"],
    outputType: "bargaining_unit",
    entityTable: bargainingUnits,
    defaultLeaf: "name",
  },
  async resolve(entity, _args, ctx) {
    const w = tokenEntityOf(entity, "worker");
    const buId = w?.row.bargainingUnitId;
    if (typeof buId !== "string") return null;
    const row = await memo(ctx, `bu-row:${buId}`, async () => {
      return (await ctx.storage.bulkTokens.getBargainingUnitRow(buId)) ?? null;
    });
    if (!row) return null;
    const out: TokenEntity = { kind: "bargaining_unit", row, table: bargainingUnits };
    return out;
  },
});

/** {{worker.work_status.field(name="name")}} or short form {{worker.work_status}} */
registerTokenPlugin({
  metadata: {
    id: "token.worker.work_status",
    name: "Work status",
    description: "The worker's current work status option",
    segmentName: "work_status",
    inputTypes: ["worker"],
    outputType: "work_status",
    entityTable: optionsWorkerWs,
    defaultLeaf: "name",
  },
  async resolve(entity, _args, ctx) {
    const w = tokenEntityOf(entity, "worker");
    const wsId = w?.row.wsId;
    if (typeof wsId !== "string") return null;
    const row = await memo(ctx, `ws-row:${wsId}`, async () => {
      return (await ctx.storage.bulkTokens.getWorkStatusRow(wsId)) ?? null;
    });
    if (!row) return null;
    const out: TokenEntity = { kind: "work_status", row, table: optionsWorkerWs };
    return out;
  },
});

/**
 * {{worker.member_status.field(name="name")}} — member statuses are a
 * set; `name` joins the option names with " / ".
 */
registerTokenPlugin({
  metadata: {
    id: "token.worker.member_status",
    name: "Member status",
    description: "The worker's member statuses (multiple values joined with /)",
    segmentName: "member_status",
    inputTypes: ["worker"],
    outputType: "member_status",
    entityFields: ["name"],
    defaultLeaf: "name",
  },
  async resolve(entity, _args, ctx) {
    const w = tokenEntityOf(entity, "worker");
    const msIds = w?.row.msIds;
    if (!Array.isArray(msIds) || msIds.length === 0) return null;
    const ids = msIds.filter((v): v is string => typeof v === "string");
    const names = await memo(ctx, `ms-names:${[...ids].sort().join(",")}`, () =>
      ctx.storage.bulkTokens.getMemberStatusNames(ids),
    );
    if (names.length === 0) return null;
    const out: TokenEntity = {
      kind: "member_status",
      row: { name: names.join(" / ") },
    };
    return out;
  },
});

/**
 * {{worker.cardcheck.field(name="type"|"status"|"signed_date")}} — the
 * worker's most recent cardcheck.
 */
registerTokenPlugin({
  metadata: {
    id: "token.worker.cardcheck",
    name: "Cardcheck",
    description: "The worker's most recent cardcheck",
    segmentName: "cardcheck",
    inputTypes: ["worker"],
    outputType: "cardcheck",
    entityFields: ["type", "status", "signed_date"],
  },
  async resolve(entity, _args, ctx) {
    const w = tokenEntityOf(entity, "worker");
    const workerId = w?.row.id;
    if (typeof workerId !== "string") return null;
    const cc = await memo(ctx, `cardcheck:${workerId}`, async () => {
      return (await ctx.storage.bulkTokens.getLatestCardcheckForWorker(workerId)) ?? null;
    });
    if (!cc) return null;
    const status = cc.status
      ? cc.status.charAt(0).toUpperCase() + cc.status.slice(1).toLowerCase()
      : null;
    const out: TokenEntity = {
      kind: "cardcheck",
      row: { type: cc.type, status, signedDate: cc.signedDate },
    };
    return out;
  },
});

/**
 * {{worker.building_rep.field(name="display_name")}} — the contact
 * record of the steward assigned to the worker's employer and
 * bargaining unit (excluding the worker themself).
 */
registerTokenPlugin({
  metadata: {
    id: "token.worker.building_rep",
    name: "Building rep",
    description: "Contact of the steward for this worker's bargaining unit and employer",
    segmentName: "building_rep",
    inputTypes: ["worker"],
    outputType: "contact",
    entityTable: contacts,
  },
  async resolve(entity, _args, ctx) {
    const w = tokenEntityOf(entity, "worker");
    if (!w) return null;
    const buId = w.row.bargainingUnitId;
    const employerId =
      w.row.homeEmployerId ??
      (Array.isArray(w.row.employerIds) ? w.row.employerIds[0] : null) ??
      null;
    if (typeof employerId !== "string" || typeof buId !== "string") return null;
    const workerId = typeof w.row.id === "string" ? w.row.id : null;
    const row = await memo(
      ctx,
      `building-rep:${employerId}:${buId}:${workerId}`,
      async () => {
        return (
          (await ctx.storage.bulkTokens.getBuildingRepContactRow(
            employerId,
            buId,
            workerId,
          )) ?? null
        );
      },
    );
    if (!row) return null;
    const out: TokenEntity = { kind: "contact", row, table: contacts };
    return out;
  },
});

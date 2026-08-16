import { employers } from "@shared/schema";
import { registerTokenPlugin } from "../registry";
import { memo, tokenEntityOf, type TokenEntity } from "../types";
import { loadWorkerEntity } from "./worker";

/**
 * Root: {{employer...}} — the recipient's employer, resolved via the
 * worker's home employer (falling back to first employment, then to
 * an employer-contact link for employer-side recipients).
 */
registerTokenPlugin({
  metadata: {
    id: "token.employer",
    name: "Employer",
    description: "The recipient's employer (home employer or first linked employer)",
    segmentName: "employer",
    inputTypes: ["root"],
    outputType: "employer",
    entityTable: employers,
    defaultLeaf: "name",
  },
  async resolve(_entity, _args, ctx) {
    if (!ctx.contactId) return null;
    const contactId = ctx.contactId;
    const row = await memo(ctx, `employer-row:${contactId}`, async () => {
      const worker = await loadWorkerEntity(ctx, contactId);
      const employerId =
        (worker?.row.homeEmployerId as string | null) ||
        (Array.isArray(worker?.row.employerIds)
          ? (worker.row.employerIds[0] as string | undefined)
          : undefined) ||
        null;
      if (employerId) {
        const emp = await ctx.storage.bulkTokens.getEmployerRow(employerId);
        if (emp) return emp;
      }
      const linked =
        await ctx.storage.bulkTokens.getFirstEmployerLinkRowForContact(contactId);
      return linked ?? null;
    });
    if (!row) return null;
    const out: TokenEntity = { kind: "employer", row, table: employers };
    return out;
  },
});

/** {{worker.home_employer}} — the worker's home employer name (default leaf). */
registerTokenPlugin({
  metadata: {
    id: "token.worker.home_employer",
    name: "Home employer",
    description: "The worker's home employer (falling back to first employment)",
    segmentName: "home_employer",
    inputTypes: ["worker"],
    outputType: "employer",
    entityTable: employers,
    defaultLeaf: "name",
  },
  async resolve(entity, _args, ctx) {
    const w = tokenEntityOf(entity, "worker");
    if (!w) return null;
    const employerId =
      w.row.homeEmployerId ??
      (Array.isArray(w.row.employerIds) ? w.row.employerIds[0] : null) ??
      null;
    if (typeof employerId !== "string") return null;
    const row = await memo(ctx, `employer-row-by-id:${employerId}`, async () => {
      return (await ctx.storage.bulkTokens.getEmployerRow(employerId)) ?? null;
    });
    if (!row) return null;
    const out: TokenEntity = { kind: "employer", row, table: employers };
    return out;
  },
});

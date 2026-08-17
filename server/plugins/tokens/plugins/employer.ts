import { employers } from "@shared/schema";
import { registerTokenPlugin } from "../registry";
import { memo, tokenEntityOf, type TokenEntity } from "../types";
import { loadWorkerEntity } from "./worker";

/**
 * Named sample employers, one per shared persona id (see the contact
 * plugin). Obviously fictional by design — a preview must never be
 * mistaken for a real employer's data.
 */
const EMPLOYER_SAMPLE_SETS = [
  {
    id: "martian",
    label: "Martian",
    values: { name: "Olympus Mons Freight", sirius_id: "SAMPLE-E01" },
  },
  {
    id: "historical",
    label: "Historical",
    values: { name: "Difference Engine Works", sirius_id: "SAMPLE-E02" },
  },
  {
    id: "mythological",
    label: "Mythological",
    values: { name: "Ithaka Shipping Company", sirius_id: "SAMPLE-E03" },
  },
];

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
    recipientRooted: true,
    recentRecords: {
      async recent(limit) {
        const { storage } = await import("../../../storage");
        const all = await storage.employers.getAllEmployers();
        const out = [];
        for (const e of all.slice(0, limit)) {
          const row = await storage.bulkTokens.getEmployerRow(e.id);
          if (!row) continue;
          out.push({
            id: e.id,
            label: e.siriusId ? `${e.name} (${e.siriusId})` : e.name,
            entity: { kind: "employer", row, table: employers },
          });
        }
        return out;
      },
    },
    sampleSets: EMPLOYER_SAMPLE_SETS,
  },
  async resolve(_entity, _args, ctx) {
    // A seeded employer wins; otherwise the root means "the recipient's
    // employer", resolved from the recipient contact.
    const seeded = ctx.roots.employer;
    if (seeded) return seeded;
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

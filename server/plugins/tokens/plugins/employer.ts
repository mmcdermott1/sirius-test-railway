import { registerTokenPlugin } from "../registry";
import { memo, type EmployerEntity } from "../types";
import { loadWorker } from "./worker";

function employerOf(entity: unknown): EmployerEntity | null {
  const e = entity as EmployerEntity | null;
  return e?.kind === "employer" ? e : null;
}

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
  },
  async resolve(_entity, _args, ctx) {
    if (!ctx.contactId) return null;
    const contactId = ctx.contactId;
    const employer = await memo(ctx, `employer:${contactId}`, async () => {
      const worker = await loadWorker(ctx, contactId);
      const employerId =
        worker?.homeEmployerId ||
        (worker?.employerIds && worker.employerIds[0]) ||
        null;
      if (employerId) {
        const emp = await ctx.storage.bulkTokens.getEmployerById(employerId);
        if (emp) return emp;
      }
      const linked = await ctx.storage.bulkTokens.getFirstEmployerLinkForContact(contactId);
      return linked ?? null;
    });
    if (!employer) return null;
    const entity: EmployerEntity = { kind: "employer", employer };
    return entity;
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.employerName",
    name: "Employer name",
    shortLabel: "name",
    description: "Name of the worker's home employer (or first linked employer)",
    segmentName: "name",
    inputTypes: ["employer"],
    outputType: "value",
    example: "Acme Construction",
  },
  async resolve(entity) {
    return employerOf(entity)?.employer.name ?? null;
  },
});

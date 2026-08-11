import { registerDispatchEligPlugin } from "../registry";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../registry";

const BAN_JOBTYPE_CATEGORY = "ban_jobtype";

/**
 * `dispatch_ban_jobtype` — READ side. Excludes workers with an active job-type
 * ban matching the job's job type. Inert when the job has no job type. The
 * `ban_jobtype` facts are maintained by the `dispatch_ban_jobtype` denorm
 * plugin.
 */
export const dispatchBanJobTypePlugin: DispatchEligPlugin = {
  id: "dispatch_ban_jobtype",
  name: "Job Type Ban",
  description: "Excludes workers banned from the job's job type",
  requiredComponent: "dispatch.ban",
  enforceOnAccept: true,

  getEligibilityCondition(context: EligibilityQueryContext, _config: Record<string, unknown>): EligibilityCondition | null {
    if (!context.jobTypeId) return null;
    return {
      category: BAN_JOBTYPE_CATEGORY,
      type: "not_exists",
      value: context.jobTypeId,
      failureMessage: "Worker is banned from this job's job type",
    };
  },

  // Live accept-time check from source ban rows (the `ban_jobtype` facts are
  // updated asynchronously, so they cannot back the hard acceptance invariant).
  async checkAcceptance(context: EligibilityQueryContext, workerId: string) {
    if (!context.jobTypeId) return null;
    const { isBanned } = await import("../../../worker-bans/service");
    const verdict = await isBanned("dispatch.accept", workerId, { jobTypeId: context.jobTypeId });
    const matches = verdict.matches.filter((m) => m.pluginId === "dispatch-job-type");
    if (matches.length === 0) return { passed: true, explanation: "No job-type ban for this job's job type" };
    const reasons = matches.map((m) => [m.banTypeName ?? "Ban", m.message].filter(Boolean).join(": "));
    return { passed: false, explanation: `Worker is banned from this job's job type (${reasons.join("; ")})` };
  },
};

registerDispatchEligPlugin(dispatchBanJobTypePlugin);

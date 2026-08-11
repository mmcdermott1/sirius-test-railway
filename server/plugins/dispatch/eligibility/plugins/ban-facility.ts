import { registerDispatchEligPlugin } from "../registry";
import { storage } from "../../../../storage";
import { isComponentEnabled } from "../../../../modules/components";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../registry";

const BAN_FACILITY_CATEGORY = "ban_facility";

/**
 * `dispatch_ban_facility` — READ side. Excludes workers with an active
 * facility ban matching the job's linked facility (dispatch_job_facility,
 * owned by the dispatch.facility component). Inert when the component is
 * disabled or the job has no facility. The `ban_facility` facts are
 * maintained by the `dispatch_ban_facility` denorm plugin.
 */
export const dispatchBanFacilityPlugin: DispatchEligPlugin = {
  id: "dispatch_ban_facility",
  name: "Facility Ban",
  description: "Excludes workers banned from the job's facility",
  requiredComponent: "dispatch.ban",

  async getEligibilityCondition(context: EligibilityQueryContext, _config: Record<string, unknown>): Promise<EligibilityCondition | null> {
    if (!(await isComponentEnabled("dispatch.facility"))) return null;
    const link = await storage.dispatchJobFacility.getByJob(context.jobId);
    if (!link?.facilityId) return null;
    return {
      category: BAN_FACILITY_CATEGORY,
      type: "not_exists",
      value: link.facilityId,
      failureMessage: "Worker is banned from this job's facility",
    };
  },

  // Live accept-time check from source ban rows (the `ban_facility` facts are
  // updated asynchronously, so they cannot back the hard acceptance invariant).
  async checkAcceptance(context: EligibilityQueryContext, workerId: string) {
    if (!(await isComponentEnabled("dispatch.facility"))) return null;
    const link = await storage.dispatchJobFacility.getByJob(context.jobId);
    if (!link?.facilityId) return null;
    const { isBanned } = await import("../../../worker-bans/service");
    const verdict = await isBanned("dispatch.accept", workerId, { facilityId: link.facilityId });
    const matches = verdict.matches.filter((m) => m.pluginId === "facility");
    if (matches.length === 0) return { passed: true, explanation: "No facility ban for this job's facility" };
    const reasons = matches.map((m) => [m.banTypeName ?? "Ban", m.message].filter(Boolean).join(": "));
    return { passed: false, explanation: `Worker is banned from this job's facility (${reasons.join("; ")})` };
  },
};

registerDispatchEligPlugin(dispatchBanFacilityPlugin);

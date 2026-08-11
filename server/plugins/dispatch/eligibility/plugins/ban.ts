import { registerDispatchEligPlugin } from "../registry";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../registry";

const BAN_CATEGORY = "ban";

/**
 * `dispatch_ban` — READ side. Excludes workers with an active dispatch ban. The
 * `ban` facts are maintained by the `dispatch_ban` denorm plugin.
 */
export const dispatchBanPlugin: DispatchEligPlugin = {
  id: "dispatch_ban",
  name: "Worker Ban",
  description: "Excludes workers who have an active dispatch ban",
  requiredComponent: "dispatch.ban",
  enforceOnAccept: true,

  getEligibilityCondition(_context: EligibilityQueryContext, _config: Record<string, unknown>): EligibilityCondition | null {
    return {
      category: BAN_CATEGORY,
      type: "not_exists_category",
      value: "dispatch:*",
    };
  },

  // Live accept-time check from source ban rows (the `ban` facts are updated
  // asynchronously, so they cannot back the hard acceptance invariant).
  async checkAcceptance(_context: EligibilityQueryContext, workerId: string) {
    const { isBanned } = await import("../../../worker-bans/service");
    const { workerBanPluginRegistry } = await import("../../../worker-bans/registry");
    const verdict = await isBanned("dispatch.accept", workerId, {});
    // Only unconditional matches (no match predicate) — conditional criteria
    // are owned by the facility / job-type eligibility plugins.
    const unconditional = verdict.matches.filter((m) => {
      const plugin = workerBanPluginRegistry.get(m.pluginId);
      return !!plugin && !plugin.matches;
    });
    if (unconditional.length === 0) return { passed: true, explanation: "No active dispatch ban" };
    const reasons = unconditional.map((m) => [m.banTypeName ?? "Ban", m.message].filter(Boolean).join(": "));
    return { passed: false, explanation: `Worker has an active dispatch ban (${reasons.join("; ")})` };
  },
};

registerDispatchEligPlugin(dispatchBanPlugin);

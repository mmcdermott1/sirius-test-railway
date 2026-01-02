import { logger } from "../../logger";
import { createWorkerBanStorage } from "../../storage/worker-bans";
import { createWorkerDispatchEligDenormStorage } from "../../storage/worker-dispatch-elig-denorm";
import type { DispatchEligPlugin, EligibilityCondition, EligibilityQueryContext } from "../dispatch-elig-plugin-registry";
import { EventType } from "../event-bus";
import type { WorkerBan } from "@shared/schema";

const BAN_CATEGORY = "ban";

function startOfDay(date: Date): Date {
  const d = new Date(date);
  d.setHours(0, 0, 0, 0);
  return d;
}

function isBanCurrentlyActive(ban: WorkerBan): boolean {
  const today = startOfDay(new Date());
  const startDay = startOfDay(new Date(ban.startDate));
  if (startDay > today) return false;
  if (!ban.endDate) return true;
  const endDay = startOfDay(new Date(ban.endDate));
  return endDay >= today;
}

export const dispatchBanPlugin: DispatchEligPlugin = {
  id: "dispatch_ban",
  name: "Worker Ban",
  description: "Excludes workers who have an active dispatch ban",
  componentId: "dispatch.ban",

  eventHandlers: [
    {
      event: EventType.WORKER_BAN_SAVED,
      getWorkerId: (payload) => payload.workerId,
    },
  ],

  getEligibilityCondition(_context: EligibilityQueryContext, _config: Record<string, unknown>): EligibilityCondition | null {
    return {
      category: BAN_CATEGORY,
      type: "not_exists_category",
      value: "dispatch:*",
    };
  },

  async recomputeWorker(workerId: string): Promise<void> {
    const banStorage = createWorkerBanStorage();
    const eligStorage = createWorkerDispatchEligDenormStorage();

    logger.debug(`Recomputing ban eligibility for worker ${workerId}`, {
      service: "dispatch-elig-ban",
      workerId,
    });

    await eligStorage.deleteByWorkerAndCategory(workerId, BAN_CATEGORY);

    const bans = await banStorage.getByWorker(workerId);
    const activeBans = bans.filter(ban => ban.type === "dispatch" && isBanCurrentlyActive(ban));

    if (activeBans.length === 0) {
      logger.debug(`No active dispatch bans for worker ${workerId}`, {
        service: "dispatch-elig-ban",
        workerId,
      });
      return;
    }

    const eligEntries = activeBans.map(ban => ({
      workerId,
      category: BAN_CATEGORY,
      value: `dispatch:${ban.id}`,
    }));

    await eligStorage.createMany(eligEntries);

    logger.debug(`Created ${eligEntries.length} ban eligibility entries for worker ${workerId}`, {
      service: "dispatch-elig-ban",
      workerId,
      activeBanCount: activeBans.length,
      banIds: activeBans.map(b => b.id),
    });
  },
};

import { storage } from "../../../../storage";
import {
  banGloballyDenies,
  isBanCurrentlyActive,
} from "../../../worker-bans/service";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

const BAN_CATEGORY = "ban";

registerCronPlugin({
  metadata: {
    id: 'sweep-expired-ban-elig',
    name: 'Sweep Expired Ban Eligibility',
    description: 'Clears dispatch eligibility entries for expired worker bans',
    requiredComponent: 'dispatch.ban',
    singleton: true,
  },
  defaultSchedule: '0 5 * * *', // Daily at 5 AM
  defaultEnabled: true,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    let workersProcessed = 0;
    let entriesRemoved = 0;

    const workerIds = await storage.workerDispatchEligDenorm.getDistinctWorkersByCategory(BAN_CATEGORY);

    for (const workerId of workerIds) {
      const bans = await storage.workerBans.getByWorker(workerId);

      // Mirror the denorm write side: only bans whose type unconditionally
      // denies dispatch acceptance count as global dispatch bans.
      const activeDispatchBans = [];
      for (const ban of bans) {
        if (isBanCurrentlyActive(ban) && (await banGloballyDenies(ban, "dispatch.accept"))) {
          activeDispatchBans.push(ban);
        }
      }

      if (activeDispatchBans.length === 0) {
        if (context.mode === 'live') {
          const deleted = await storage.workerDispatchEligDenorm.deleteByWorkerAndCategory(workerId, BAN_CATEGORY);
          entriesRemoved += deleted;
        } else {
          const toDeleteCount = await storage.workerDispatchEligDenorm.countByWorkerAndCategory(workerId, BAN_CATEGORY);
          entriesRemoved += toDeleteCount;
        }
      }

      workersProcessed++;
    }

    const verb = context.mode === 'live' ? 'Removed' : 'Would remove';

    return {
      message: `${verb} ${entriesRemoved} expired ban eligibility entries from ${workersProcessed} workers`,
      metadata: { workersProcessed, entriesRemoved },
    };
  },
});

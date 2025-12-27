import { CronJobHandler, CronJobContext, CronJobSummary } from "../registry";
import { createWorkerDispatchHfeStorage } from "../../storage/worker-dispatch-hfe";
import { logger } from "../../logger";

export const deleteExpiredHfeHandler: CronJobHandler = {
  description: 'Deletes Hold for Employer entries where the hold date has passed',
  requiresComponent: 'dispatch.hfe',
  
  async execute(context: CronJobContext): Promise<CronJobSummary> {
    logger.info('Starting expired HFE entries cleanup', {
      service: 'cron-delete-expired-hfe',
      jobId: context.jobId,
      mode: context.mode,
    });

    try {
      const hfeStorage = createWorkerDispatchHfeStorage();

      if (context.mode === 'test') {
        const expiredCount = await hfeStorage.countExpired();

        logger.info('[TEST MODE] Expired HFE cleanup - would delete', {
          service: 'cron-delete-expired-hfe',
          jobId: context.jobId,
          expiredCount,
        });

        return {
          mode: 'test',
          wouldDelete: expiredCount,
        };
      }

      const deletedCount = await hfeStorage.deleteExpired();

      logger.info('Expired HFE entries cleanup completed', {
        service: 'cron-delete-expired-hfe',
        jobId: context.jobId,
        deletedCount,
      });

      return {
        mode: 'live',
        deletedCount,
      };

    } catch (error) {
      logger.error('Failed to delete expired HFE entries', {
        service: 'cron-delete-expired-hfe',
        jobId: context.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  },
};

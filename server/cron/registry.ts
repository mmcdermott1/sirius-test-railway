import { logger } from "../logger";
import { z } from "zod";

export interface CronJobContext {
  jobId: string;
  jobName: string;
  triggeredBy?: string;
  isManual: boolean;
  mode: "live" | "test"; // "live" for production runs, "test" for dry-run (no DB changes)
  settings: Record<string, unknown>; // Job-specific settings
}

export interface CronJobSummary {
  [key: string]: any; // Flexible summary data specific to each job
}

export interface CronJobSettingsField {
  key: string;
  label: string;
  type: "number" | "string" | "boolean";
  description?: string;
  min?: number; // For number type
  max?: number; // For number type
}

export interface CronJobHandler {
  execute: (context: CronJobContext) => Promise<CronJobSummary>;
  description?: string;
  settingsSchema?: z.ZodSchema; // Zod schema for validating settings
  getDefaultSettings?: () => Record<string, unknown>; // Default settings values
  getSettingsFields?: () => CronJobSettingsField[]; // UI field definitions
}

export interface RegisteredCronJob {
  name: string;
  handler: CronJobHandler;
  description?: string;
}

class CronJobRegistry {
  private jobs: Map<string, CronJobHandler> = new Map();

  register(name: string, handler: CronJobHandler): void {
    if (this.jobs.has(name)) {
      throw new Error(`Cron job "${name}" is already registered`);
    }
    this.jobs.set(name, handler);
    logger.info(`Registered cron job: ${name}`, { service: 'cron-registry' });
  }

  get(name: string): CronJobHandler | undefined {
    return this.jobs.get(name);
  }

  getAll(): RegisteredCronJob[] {
    return Array.from(this.jobs.entries()).map(([name, handler]) => ({
      name,
      handler,
      description: handler.description,
    }));
  }

  getAllNames(): string[] {
    return Array.from(this.jobs.keys());
  }

  has(name: string): boolean {
    return this.jobs.has(name);
  }

  async execute(name: string, context: CronJobContext): Promise<CronJobSummary> {
    const handler = this.jobs.get(name);
    if (!handler) {
      throw new Error(`Cron job "${name}" is not registered`);
    }

    logger.info(`Executing cron job: ${name}`, {
      service: 'cron-registry',
      jobId: context.jobId,
      isManual: context.isManual,
      triggeredBy: context.triggeredBy,
    });

    try {
      const summary = await handler.execute(context);
      logger.info(`Cron job completed successfully: ${name}`, {
        service: 'cron-registry',
        jobId: context.jobId,
        summary,
      });
      return summary;
    } catch (error) {
      logger.error(`Cron job failed: ${name}`, {
        service: 'cron-registry',
        jobId: context.jobId,
        error: error instanceof Error ? error.message : String(error),
      });
      throw error;
    }
  }
}

export const cronJobRegistry = new CronJobRegistry();

export function registerCronJob(name: string, handler: CronJobHandler): void {
  cronJobRegistry.register(name, handler);
}

export function getCronJobHandler(name: string): CronJobHandler | undefined {
  return cronJobRegistry.get(name);
}

export function getAllCronJobs(): RegisteredCronJob[] {
  return cronJobRegistry.getAll();
}

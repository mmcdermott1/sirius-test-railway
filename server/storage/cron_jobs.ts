import { db } from "../db";
import { cronJobs, cronJobRuns, type CronJob, type InsertCronJob, type CronJobRun, type InsertCronJobRun } from "@shared/schema";
import { eq, desc, and } from "drizzle-orm";
import { sql } from "drizzle-orm";

export interface CronJobStorage {
  list(): Promise<CronJob[]>;
  getById(id: string): Promise<CronJob | undefined>;
  getByName(name: string): Promise<CronJob | undefined>;
  create(job: InsertCronJob): Promise<CronJob>;
  update(id: string, updates: Partial<Omit<InsertCronJob, 'id'>>): Promise<CronJob | undefined>;
  delete(id: string): Promise<boolean>;
}

export interface CronJobRunStorage {
  list(filters?: { jobId?: string; status?: string }): Promise<CronJobRun[]>;
  getById(id: string): Promise<CronJobRun | undefined>;
  getLatestByJobId(jobId: string): Promise<CronJobRun | undefined>;
  create(run: InsertCronJobRun): Promise<CronJobRun>;
  update(id: string, updates: Partial<Omit<InsertCronJobRun, 'id'>>): Promise<CronJobRun | undefined>;
  delete(id: string): Promise<boolean>;
  deleteByJobId(jobId: string): Promise<number>;
}

export function createCronJobStorage(): CronJobStorage {
  return {
    async list(): Promise<CronJob[]> {
      return db
        .select()
        .from(cronJobs)
        .orderBy(cronJobs.name);
    },

    async getById(id: string): Promise<CronJob | undefined> {
      const [job] = await db.select().from(cronJobs).where(eq(cronJobs.id, id));
      return job || undefined;
    },

    async getByName(name: string): Promise<CronJob | undefined> {
      const [job] = await db.select().from(cronJobs).where(eq(cronJobs.name, name));
      return job || undefined;
    },

    async create(insertJob: InsertCronJob): Promise<CronJob> {
      const [job] = await db
        .insert(cronJobs)
        .values(insertJob)
        .returning();
      return job;
    },

    async update(id: string, updates: Partial<Omit<InsertCronJob, 'id'>>): Promise<CronJob | undefined> {
      const [job] = await db
        .update(cronJobs)
        .set({ ...updates, updatedAt: new Date() })
        .where(eq(cronJobs.id, id))
        .returning();
      return job || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(cronJobs).where(eq(cronJobs.id, id)).returning();
      return result.length > 0;
    },
  };
}

export function createCronJobRunStorage(): CronJobRunStorage {
  return {
    async list(filters?: { jobId?: string; status?: string }): Promise<CronJobRun[]> {
      const conditions = [];
      
      if (filters?.jobId) {
        conditions.push(eq(cronJobRuns.jobId, filters.jobId));
      }
      if (filters?.status) {
        conditions.push(eq(cronJobRuns.status, filters.status));
      }

      if (conditions.length > 0) {
        return db
          .select()
          .from(cronJobRuns)
          .where(and(...conditions))
          .orderBy(desc(cronJobRuns.startedAt));
      } else {
        return db
          .select()
          .from(cronJobRuns)
          .orderBy(desc(cronJobRuns.startedAt));
      }
    },

    async getById(id: string): Promise<CronJobRun | undefined> {
      const [run] = await db.select().from(cronJobRuns).where(eq(cronJobRuns.id, id));
      return run || undefined;
    },

    async getLatestByJobId(jobId: string): Promise<CronJobRun | undefined> {
      const [run] = await db
        .select()
        .from(cronJobRuns)
        .where(eq(cronJobRuns.jobId, jobId))
        .orderBy(desc(cronJobRuns.startedAt))
        .limit(1);
      return run || undefined;
    },

    async create(insertRun: InsertCronJobRun): Promise<CronJobRun> {
      const [run] = await db
        .insert(cronJobRuns)
        .values(insertRun)
        .returning();
      return run;
    },

    async update(id: string, updates: Partial<Omit<InsertCronJobRun, 'id'>>): Promise<CronJobRun | undefined> {
      const [run] = await db
        .update(cronJobRuns)
        .set(updates)
        .where(eq(cronJobRuns.id, id))
        .returning();
      return run || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(cronJobRuns).where(eq(cronJobRuns.id, id)).returning();
      return result.length > 0;
    },

    async deleteByJobId(jobId: string): Promise<number> {
      const result = await db
        .delete(cronJobRuns)
        .where(eq(cronJobRuns.jobId, jobId))
        .returning();
      return result.length;
    }
  };
}

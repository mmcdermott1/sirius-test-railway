import { pgTable, varchar, date } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers, employers } from "../../schema";

export const workerDispatchHfe = pgTable("worker_dispatch_hfe", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").notNull().references(() => workers.id, { onDelete: 'cascade' }),
  employerId: varchar("employer_id").notNull().references(() => employers.id, { onDelete: 'cascade' }),
  holdUntil: date("hold_until").notNull(),
});

export const insertWorkerDispatchHfeSchema = createInsertSchema(workerDispatchHfe).omit({
  id: true,
}).extend({
  holdUntil: z.coerce.date(),
});

export type InsertWorkerDispatchHfe = z.infer<typeof insertWorkerDispatchHfeSchema>;
export type WorkerDispatchHfe = typeof workerDispatchHfe.$inferSelect;

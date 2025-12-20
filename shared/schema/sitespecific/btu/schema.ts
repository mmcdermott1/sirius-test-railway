import { pgTable, text, timestamp, varchar } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";
import { workers } from "../../../schema";

export const sitespecificBtuCsg = pgTable("sitespecific_btu_csg", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  workerId: varchar("worker_id").references(() => workers.id, { onDelete: 'set null' }),
  bpsId: text("bps_id"),
  firstName: text("first_name"),
  lastName: text("last_name"),
  phone: text("phone"),
  nonBpsEmail: text("non_bps_email"),
  school: text("school"),
  principalHeadmaster: text("principal_headmaster"),
  role: text("role"),
  typeOfClass: text("type_of_class"),
  course: text("course"),
  section: text("section"),
  numberOfStudents: text("number_of_students"),
  comments: text("comments"),
  status: text("status").default("pending").notNull(),
  adminNotes: text("admin_notes"),
  createdAt: timestamp("created_at").defaultNow().notNull(),
  updatedAt: timestamp("updated_at").defaultNow().notNull(),
});

export const insertBtuCsgSchema = createInsertSchema(sitespecificBtuCsg).omit({
  id: true,
  createdAt: true,
  updatedAt: true,
});

export type BtuCsgRecord = typeof sitespecificBtuCsg.$inferSelect;
export type InsertBtuCsgRecord = z.infer<typeof insertBtuCsgSchema>;

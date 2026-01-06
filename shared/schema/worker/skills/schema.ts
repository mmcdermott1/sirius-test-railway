import { pgTable, varchar, text, jsonb } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

export const optionsSkills = pgTable("options_skills", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  name: varchar("name", { length: 255 }).notNull(),
  description: text("description"),
  data: jsonb("data"),
});

export const insertOptionsSkillsSchema = createInsertSchema(optionsSkills).omit({
  id: true,
});

export type OptionsSkill = typeof optionsSkills.$inferSelect;
export type InsertOptionsSkill = z.infer<typeof insertOptionsSkillsSchema>;

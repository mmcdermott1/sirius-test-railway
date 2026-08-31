import { sql } from "drizzle-orm";
import { pgTable, pgEnum, text, varchar, jsonb, timestamp, index, unique } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";
import { z } from "zod";

/**
 * "wc" — web client. The outbound half of the third-party plumbing, sitting
 * next to the inbound "ws" web-service tooling in `../webservices/schema.ts`.
 *
 * One row per distinct outbound request. What makes two requests "the same"
 * is decided by the per-request canonicalizer in the behavior registry
 * (`server/services/webclient/registry.ts`), not by this table — the table
 * only stores whatever string that canonicalizer produced and enforces that
 * it is unique within its (service, request type).
 */
export const wcCacheOutcomeEnum = pgEnum("wc_cache_outcome", ["success", "failure"]);

/**
 * The stored answer to one outbound request.
 *
 * `request_key` is the canonical key in readable form (a phone number, a full
 * address) and `request_key_hash` is its SHA-256, which is what actually
 * carries the uniqueness constraint: keys can be long enough to blow a btree
 * entry, and Postgres would silently refuse the index rather than truncate.
 * The readable copy is kept because browsing a cache of opaque hashes tells
 * an operator nothing.
 *
 * `outcome` records what the LAST attempt against this key produced.
 * A `failure` row is not a stored answer — it is the record that an attempt
 * failed, and it is what holds off the next attempt (see
 * `failureRememberedFor` in the registry). Because there is one row per
 * request, a failure that lands on top of a stale success replaces it; the
 * wrapper deliberately refuses to overwrite a success that is still FRESH, so
 * a vendor outage during a forced refresh cannot destroy an answer we have
 * paid for and would still be serving.
 *
 * `fetched_at` is when the vendor was asked — the timestamp freshness is
 * judged against — and `created_at` is when we first learned about this
 * request key at all.
 */
export const wcCache = pgTable("wc_cache", {
  id: varchar("id").primaryKey().default(sql`gen_random_uuid()`),
  service: varchar("service", { length: 64 }).notNull(),
  requestType: varchar("request_type", { length: 64 }).notNull(),
  requestKey: text("request_key").notNull(),
  requestKeyHash: varchar("request_key_hash", { length: 64 }).notNull(),
  outcome: wcCacheOutcomeEnum("outcome").notNull(),
  response: jsonb("response"),
  fetchedAt: timestamp("fetched_at").notNull(),
  createdAt: timestamp("created_at").default(sql`now()`).notNull(),
}, (table) => ({
  // Named UNIQUE CONSTRAINT (not a unique index) so the startup drift gate
  // sees the same object the migration creates.
  requestUnique: unique("wc_cache_service_type_key_hash_uniq").on(
    table.service,
    table.requestType,
    table.requestKeyHash,
  ),
  // The sweep's access pattern: everything of one request type older than a
  // cutoff. The unique constraint's index already serves point lookups.
  sweepIdx: index("wc_cache_sweep_idx").on(table.service, table.requestType, table.fetchedAt),
}));

export const insertWcCacheSchema = createInsertSchema(wcCache, {
  service: z.string().min(1).max(64),
  requestType: z.string().min(1).max(64),
  requestKey: z.string().min(1),
  requestKeyHash: z.string().length(64),
}).omit({
  id: true,
  createdAt: true,
});

export type WcCacheOutcome = (typeof wcCacheOutcomeEnum.enumValues)[number];
export type InsertWcCache = z.infer<typeof insertWcCacheSchema>;
export type WcCache = typeof wcCache.$inferSelect;

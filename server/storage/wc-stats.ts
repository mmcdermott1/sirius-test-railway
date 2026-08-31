import { sql, and, eq, gte, lte, asc, type SQL } from 'drizzle-orm';
import { wcStats } from '@shared/schema';
import type { Ymd } from '@shared/utils/date';
import { getClient } from './transaction-context';

/**
 * How many outbound third-party calls we actually made, per day.
 *
 * Deliberately a leaf, for the same reason as `wc-cache`: it imports the
 * transaction context and the schema and nothing else, because the wrapper in
 * `server/services/webclient` reaches it directly rather than through the
 * storage barrel, and the barrel pulls in modules that themselves normalize
 * arguments through code that makes outbound requests.
 *
 * The counter answers a question the cache cannot: the cache holds one row per
 * request key carrying only the last attempt, and an uncached request type
 * writes to it not at all.
 */

/** One day's calls, as counted for the filters asked for. */
export interface WcStatsDay {
  day: Ymd;
  calls: number;
}

/** A (service, request type) pair that has at least one counted call. */
export interface WcStatsDimension {
  service: string;
  requestType: string;
}

/** Narrowing for the stats read. Every field is optional. */
export interface WcStatsFilters {
  service?: string;
  requestType?: string;
}

export interface WcStatsRangeParams extends WcStatsFilters {
  /** Inclusive first day of the range. */
  start: Ymd;
  /** Inclusive last day of the range. */
  end: Ymd;
}

export interface WcStatsStorage {
  /**
   * Count one call against (service, request type, day).
   *
   * An atomic insert-or-increment on the uniqueness tuple: two calls landing
   * at once cannot read-modify-write over each other and lose a count.
   */
  recordCall(service: string, requestType: string, day: Ymd): Promise<void>;
  /** Calls per day inside the range, oldest first. Days with none are absent. */
  countsByDay(params: WcStatsRangeParams): Promise<WcStatsDay[]>;
  /**
   * Every (service, request type) the table has ever counted.
   *
   * Read from the counts rather than from the behavior registry so a request
   * type a release has since retired stays selectable — its calls are exactly
   * the ones somebody looking at this screen wants to account for.
   */
  listDimensions(): Promise<WcStatsDimension[]>;
}

function rangeCondition(params: WcStatsRangeParams): SQL {
  // Ymd strings compare correctly as strings, which is the point of storing
  // the day as one: no timezone gets a chance to move a call to another day.
  const conditions: SQL[] = [gte(wcStats.day, params.start), lte(wcStats.day, params.end)];
  if (params.service) conditions.push(eq(wcStats.service, params.service));
  if (params.requestType) conditions.push(eq(wcStats.requestType, params.requestType));
  return and(...conditions) as SQL;
}

export function createWcStatsStorage(): WcStatsStorage {
  return {
    async recordCall(service: string, requestType: string, day: Ymd): Promise<void> {
      const client = getClient();
      await client
        .insert(wcStats)
        .values({ service, requestType, day, calls: 1 })
        .onConflictDoUpdate({
          target: [wcStats.service, wcStats.requestType, wcStats.day],
          set: { calls: sql`${wcStats.calls} + 1` },
        });
    },

    async countsByDay(params: WcStatsRangeParams): Promise<WcStatsDay[]> {
      const client = getClient();
      const rows = await client
        .select({
          day: wcStats.day,
          calls: sql<number>`sum(${wcStats.calls})::int`,
        })
        .from(wcStats)
        .where(rangeCondition(params))
        .groupBy(wcStats.day)
        .orderBy(asc(wcStats.day));
      return rows.map((row) => ({ day: row.day, calls: Number(row.calls ?? 0) }));
    },

    async listDimensions(): Promise<WcStatsDimension[]> {
      const client = getClient();
      const rows = await client
        .select({ service: wcStats.service, requestType: wcStats.requestType })
        .from(wcStats)
        .groupBy(wcStats.service, wcStats.requestType)
        .orderBy(asc(wcStats.service), asc(wcStats.requestType));
      return rows;
    },
  };
}

export const wcStatsStorage = createWcStatsStorage();

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
  ymd: Ymd;
  calls: number;
}

/** One service's calls, summed over the range asked for. */
export interface WcStatsService {
  service: string;
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
  recordCall(service: string, requestType: string, ymd: Ymd): Promise<void>;
  /** Calls per day inside the range, oldest first. Days with none are absent. */
  countsByDay(params: WcStatsRangeParams): Promise<WcStatsDay[]>;
  /**
   * Calls per service inside the range, by service name. Services with no
   * calls in the range are absent — including a service that is registered
   * but was never called, and including, conversely, a service that has
   * counts but is no longer registered: this reads the counts, not the
   * behavior registry, so a retired service's calls are still accounted for.
   */
  countsByService(params: WcStatsRangeParams): Promise<WcStatsService[]>;
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
  // The day is a Postgres `date`, compared against Ymd strings: no timezone
  // gets a chance to move a call to another day, and the range means the same
  // inclusive span it always did.
  const conditions: SQL[] = [gte(wcStats.ymd, params.start), lte(wcStats.ymd, params.end)];
  if (params.service) conditions.push(eq(wcStats.service, params.service));
  if (params.requestType) conditions.push(eq(wcStats.requestType, params.requestType));
  return and(...conditions) as SQL;
}

export function createWcStatsStorage(): WcStatsStorage {
  return {
    async recordCall(service: string, requestType: string, ymd: Ymd): Promise<void> {
      const client = getClient();
      await client
        .insert(wcStats)
        .values({ service, requestType, ymd, calls: 1 })
        .onConflictDoUpdate({
          target: [wcStats.service, wcStats.requestType, wcStats.ymd],
          set: { calls: sql`${wcStats.calls} + 1` },
        });
    },

    async countsByDay(params: WcStatsRangeParams): Promise<WcStatsDay[]> {
      const client = getClient();
      const rows = await client
        .select({
          ymd: wcStats.ymd,
          calls: sql<number>`sum(${wcStats.calls})::int`,
        })
        .from(wcStats)
        .where(rangeCondition(params))
        .groupBy(wcStats.ymd)
        .orderBy(asc(wcStats.ymd));
      return rows.map((row) => ({ ymd: row.ymd, calls: Number(row.calls ?? 0) }));
    },

    async countsByService(params: WcStatsRangeParams): Promise<WcStatsService[]> {
      const client = getClient();
      const rows = await client
        .select({
          service: wcStats.service,
          calls: sql<number>`sum(${wcStats.calls})::int`,
        })
        .from(wcStats)
        // The same range/filter builder the per-day read uses, so the two
        // reads can never disagree about which calls are inside the window.
        .where(rangeCondition(params))
        .groupBy(wcStats.service)
        .orderBy(asc(wcStats.service));
      return rows.map((row) => ({ service: row.service, calls: Number(row.calls ?? 0) }));
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

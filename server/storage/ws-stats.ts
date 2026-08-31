import { sql, and, eq, gte, lte, asc, type SQL } from 'drizzle-orm';
import { wsStats } from '@shared/schema';
import type { Ymd } from '@shared/utils/date';
import { getClient } from './transaction-context';

/**
 * How many incoming web service calls we served, per day — the inbound mirror
 * of `wc-stats`.
 *
 * The counter answers a question the request log cannot: the log is
 * per-request and pruned on a retention schedule, so "how much did this
 * partner use us last quarter" stops being answerable the moment the window
 * closes. These four dimensions — plugin, client, operation, day — are what a
 * usage screen filters and drills on, and nothing else is kept.
 *
 * "Client" is unfortunately two things in this file: the calling partner, and
 * the Drizzle handle. The partner is always `clientId`; the handle is always
 * `conn`.
 */

/** One day's calls, as counted for the filters asked for. */
export interface WsStatsDay {
  ymd: Ymd;
  calls: number;
}

/** A (plugin, client, operation) triple that has at least one counted call. */
export interface WsStatsDimension {
  pluginId: string;
  clientId: string;
  operation: string;
}

/** One plugin's calls, summed over the range asked for. */
export interface WsStatsPlugin {
  pluginId: string;
  calls: number;
}

/** One (plugin, operation) pair's calls, summed over the range asked for. */
export interface WsStatsPluginOperation {
  pluginId: string;
  operation: string;
  calls: number;
}

/** One calling client's calls, summed over the range asked for. */
export interface WsStatsClient {
  clientId: string;
  calls: number;
}

/** One (plugin, client, operation) triple's calls over the range asked for. */
export interface WsStatsDimensionCalls extends WsStatsDimension {
  calls: number;
}

/** Narrowing for the stats read. Every field is optional. */
export interface WsStatsFilters {
  pluginId?: string;
  clientId?: string;
  operation?: string;
}

export interface WsStatsRangeParams extends WsStatsFilters {
  /** Inclusive first day of the range. */
  start: Ymd;
  /** Inclusive last day of the range. */
  end: Ymd;
}

export interface WsStatsStorage {
  /**
   * Count one served call against (plugin, client, operation, day).
   *
   * An atomic insert-or-increment on the uniqueness tuple: two calls landing
   * at once cannot read-modify-write over each other and lose a count.
   */
  recordCall(pluginId: string, clientId: string, operation: string, ymd: Ymd): Promise<void>;
  /** Calls per day inside the range, oldest first. Days with none are absent. */
  countsByDay(params: WsStatsRangeParams): Promise<WsStatsDay[]>;
  /**
   * Calls per (plugin, client, operation) inside the range. The finest
   * grouping the counter can answer for a range, and the one every coarser
   * read below is rolled up from.
   */
  countsByDimension(params: WsStatsRangeParams): Promise<WsStatsDimensionCalls[]>;
  /**
   * Calls per (plugin, operation) inside the range — the drill-down from a
   * service into what was called on it.
   */
  countsByPluginOperation(params: WsStatsRangeParams): Promise<WsStatsPluginOperation[]>;
  /**
   * Calls per plugin inside the range: "which of our services carries the
   * traffic".
   *
   * Plugins with no calls in the range are absent — including one that is
   * registered but was never called, and including, conversely, one that has
   * counts but is no longer registered: this reads the counts, not the plugin
   * registry, so a retired service's calls are still accounted for.
   */
  countsByPlugin(params: WsStatsRangeParams): Promise<WsStatsPlugin[]>;
  /** Calls per calling client inside the range: "who is using us". */
  countsByClient(params: WsStatsRangeParams): Promise<WsStatsClient[]>;
  /**
   * Every (plugin, client, operation) the table has ever counted.
   *
   * Read from the counts rather than from the plugin registry so a filter can
   * offer what actually exists rather than what the registry currently
   * declares — an operation a release has since retired stays selectable, and
   * its calls are exactly the ones somebody looking at this screen wants to
   * account for.
   */
  listDimensions(): Promise<WsStatsDimension[]>;
}

function rangeCondition(params: WsStatsRangeParams): SQL {
  // The day is a Postgres `date`, compared against Ymd strings: no timezone
  // gets a chance to move a call to another day, and the range means the same
  // inclusive span it always did.
  const conditions: SQL[] = [gte(wsStats.ymd, params.start), lte(wsStats.ymd, params.end)];
  if (params.pluginId) conditions.push(eq(wsStats.pluginId, params.pluginId));
  if (params.clientId) conditions.push(eq(wsStats.clientId, params.clientId));
  if (params.operation) conditions.push(eq(wsStats.operation, params.operation));
  return and(...conditions) as SQL;
}

/**
 * The one range-grouped read. Every breakdown except the per-day one is
 * answered from this single query, so no two of them can disagree about which
 * calls fall inside the window — which is the whole reason a later screen can
 * show a service total beside its operation rows and have them add up.
 */
async function readCountsByDimension(
  params: WsStatsRangeParams,
): Promise<WsStatsDimensionCalls[]> {
  const conn = getClient();
  const rows = await conn
    .select({
      pluginId: wsStats.pluginId,
      clientId: wsStats.clientId,
      operation: wsStats.operation,
      calls: sql<number>`sum(${wsStats.calls})::int`,
    })
    .from(wsStats)
    .where(rangeCondition(params))
    .groupBy(wsStats.pluginId, wsStats.clientId, wsStats.operation)
    .orderBy(asc(wsStats.pluginId), asc(wsStats.clientId), asc(wsStats.operation));
  return rows.map((row) => ({
    pluginId: row.pluginId,
    clientId: row.clientId,
    operation: row.operation,
    calls: Number(row.calls ?? 0),
  }));
}

/** Sum `calls` into buckets named by `key`, then sort by that name. */
function rollUp<T>(
  rows: WsStatsDimensionCalls[],
  key: (row: WsStatsDimensionCalls) => string,
  build: (name: string, calls: number) => T,
): T[] {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const name = key(row);
    totals.set(name, (totals.get(name) ?? 0) + row.calls);
  }
  return Array.from(totals)
    .sort((a, b) => a[0].localeCompare(b[0]))
    .map(([name, calls]) => build(name, calls));
}

/** Separator for composite roll-up keys; not a value any dimension can hold. */
const KEY_SEPARATOR = '\u0000';

export function createWsStatsStorage(): WsStatsStorage {
  return {
    async recordCall(
      pluginId: string,
      clientId: string,
      operation: string,
      ymd: Ymd,
    ): Promise<void> {
      const conn = getClient();
      await conn
        .insert(wsStats)
        .values({ pluginId, clientId, operation, ymd, calls: 1 })
        .onConflictDoUpdate({
          target: [wsStats.pluginId, wsStats.clientId, wsStats.operation, wsStats.ymd],
          set: { calls: sql`${wsStats.calls} + 1` },
        });
    },

    async countsByDay(params: WsStatsRangeParams): Promise<WsStatsDay[]> {
      // The only read that does not come off the dimension query: the day is
      // not one of its grouping columns.
      const conn = getClient();
      const rows = await conn
        .select({
          ymd: wsStats.ymd,
          calls: sql<number>`sum(${wsStats.calls})::int`,
        })
        .from(wsStats)
        .where(rangeCondition(params))
        .groupBy(wsStats.ymd)
        .orderBy(asc(wsStats.ymd));
      return rows.map((row) => ({ ymd: row.ymd, calls: Number(row.calls ?? 0) }));
    },

    async countsByDimension(params: WsStatsRangeParams): Promise<WsStatsDimensionCalls[]> {
      return readCountsByDimension(params);
    },

    async countsByPluginOperation(
      params: WsStatsRangeParams,
    ): Promise<WsStatsPluginOperation[]> {
      const rows = await readCountsByDimension(params);
      return rollUp(
        rows,
        (row) => `${row.pluginId}${KEY_SEPARATOR}${row.operation}`,
        (name, calls) => {
          const [pluginId, operation] = name.split(KEY_SEPARATOR);
          return { pluginId, operation, calls };
        },
      );
    },

    async countsByPlugin(params: WsStatsRangeParams): Promise<WsStatsPlugin[]> {
      const rows = await readCountsByDimension(params);
      return rollUp(rows, (row) => row.pluginId, (pluginId, calls) => ({ pluginId, calls }));
    },

    async countsByClient(params: WsStatsRangeParams): Promise<WsStatsClient[]> {
      const rows = await readCountsByDimension(params);
      return rollUp(rows, (row) => row.clientId, (clientId, calls) => ({ clientId, calls }));
    },

    async listDimensions(): Promise<WsStatsDimension[]> {
      const conn = getClient();
      return await conn
        .select({
          pluginId: wsStats.pluginId,
          clientId: wsStats.clientId,
          operation: wsStats.operation,
        })
        .from(wsStats)
        .groupBy(wsStats.pluginId, wsStats.clientId, wsStats.operation)
        .orderBy(asc(wsStats.pluginId), asc(wsStats.clientId), asc(wsStats.operation));
    },
  };
}

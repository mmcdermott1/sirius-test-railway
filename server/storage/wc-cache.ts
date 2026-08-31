import { createHash } from 'crypto';
import { sql, and, eq, lt } from 'drizzle-orm';
import { wcCache, type WcCacheOutcome } from '@shared/schema';
import { getClient } from './transaction-context';

/**
 * The stored answers to outbound third-party requests.
 *
 * Deliberately a leaf: it imports the transaction context and the schema and
 * nothing else. The wrapper in `server/services/webclient` reaches this module
 * directly rather than through the storage barrel, because the barrel pulls in
 * the storage modules that themselves normalize arguments through code that
 * makes outbound requests.
 */
export interface WcCacheEntry {
  service: string;
  requestType: string;
  requestKey: string;
  outcome: WcCacheOutcome;
  /** The response body, as stored. For a failure this is `{ error }`. */
  response: unknown;
  /** When the vendor was asked. Freshness is judged against this. */
  fetchedAt: Date;
}

/** One request type's idea of what is past its useful life. */
export interface WcCacheExpiry {
  service: string;
  requestType: string;
  /** Successes fetched before this moment are gone. */
  successOlderThan: Date;
  /** Failures recorded before this moment are gone. */
  failureOlderThan: Date;
}

export interface WcCacheStorage {
  read(service: string, requestType: string, requestKey: string): Promise<WcCacheEntry | undefined>;
  /** Store an answer, replacing whatever was there. */
  writeSuccess(
    service: string,
    requestType: string,
    requestKey: string,
    response: unknown,
  ): Promise<void>;
  /**
   * Record that an attempt failed.
   *
   * `keepSuccessNewerThan` is the freshness boundary the wrapper just judged
   * against: a success fetched after it is still being served, and a vendor
   * outage during a forced refresh must not destroy it. An older success is
   * one nobody would be served anyway, so the failure replaces it and becomes
   * the hold that stops the next read attempting again.
   */
  writeFailure(
    service: string,
    requestType: string,
    requestKey: string,
    error: string | undefined,
    keepSuccessNewerThan: Date,
  ): Promise<void>;
  /**
   * Whether the connection this write would go out on accepts writes.
   *
   * Asked of the connection rather than tracked alongside it, so it cannot
   * drift from reality and so it picks up every mechanism that sets the
   * setting — `SET TRANSACTION READ ONLY` in the read-only storage helper,
   * `default_transaction_read_only` armed per pool checkout in maintenance
   * mode, and anything added later — without knowing any of them by name.
   */
  canStore(): Promise<boolean>;
  /** Delete everything past its useful life. Returns how many rows went. */
  purgeExpired(expiries: WcCacheExpiry[]): Promise<number>;
  /** The same count, without deleting anything. */
  countExpired(expiries: WcCacheExpiry[]): Promise<number>;
  /** Distinct (service, request type) pairs actually present in the table. */
  listRequestTypes(): Promise<Array<{ service: string; requestType: string; rows: number }>>;
}

/**
 * The canonical request key's SHA-256, in hex.
 *
 * The hash is what carries uniqueness: keys are canonical strings that can run
 * to a full postal address, and a btree entry has a length Postgres will
 * refuse rather than truncate.
 */
export function wcRequestKeyHash(requestKey: string): string {
  return createHash('sha256').update(requestKey, 'utf8').digest('hex');
}

function expiryCondition(expiry: WcCacheExpiry) {
  return and(
    eq(wcCache.service, expiry.service),
    eq(wcCache.requestType, expiry.requestType),
    sql`(
      (${wcCache.outcome} = 'success' AND ${lt(wcCache.fetchedAt, expiry.successOlderThan)})
      OR (${wcCache.outcome} = 'failure' AND ${lt(wcCache.fetchedAt, expiry.failureOlderThan)})
    )`,
  );
}

export function createWcCacheStorage(): WcCacheStorage {
  return {
    async read(
      service: string,
      requestType: string,
      requestKey: string,
    ): Promise<WcCacheEntry | undefined> {
      const client = getClient();
      const [row] = await client
        .select({
          service: wcCache.service,
          requestType: wcCache.requestType,
          requestKey: wcCache.requestKey,
          outcome: wcCache.outcome,
          response: wcCache.response,
          fetchedAt: wcCache.fetchedAt,
        })
        .from(wcCache)
        .where(
          and(
            eq(wcCache.service, service),
            eq(wcCache.requestType, requestType),
            eq(wcCache.requestKeyHash, wcRequestKeyHash(requestKey)),
          ),
        );
      return row || undefined;
    },

    async writeSuccess(
      service: string,
      requestType: string,
      requestKey: string,
      response: unknown,
    ): Promise<void> {
      const client = getClient();
      const fetchedAt = new Date();
      // Written on the CALLER'S connection, inside whatever transaction the
      // caller holds. A caller that later rolls back discards the answer,
      // which costs one repeat request and nothing else.
      await client
        .insert(wcCache)
        .values({
          service,
          requestType,
          requestKey,
          requestKeyHash: wcRequestKeyHash(requestKey),
          outcome: 'success',
          response: response as any,
          fetchedAt,
        })
        .onConflictDoUpdate({
          target: [wcCache.service, wcCache.requestType, wcCache.requestKeyHash],
          set: {
            requestKey,
            outcome: 'success',
            response: response as any,
            fetchedAt,
          },
        });
    },

    async writeFailure(
      service: string,
      requestType: string,
      requestKey: string,
      error: string | undefined,
      keepSuccessNewerThan: Date,
    ): Promise<void> {
      const client = getClient();
      const fetchedAt = new Date();
      await client
        .insert(wcCache)
        .values({
          service,
          requestType,
          requestKey,
          requestKeyHash: wcRequestKeyHash(requestKey),
          outcome: 'failure',
          response: { error: error ?? null } as any,
          fetchedAt,
        })
        .onConflictDoUpdate({
          target: [wcCache.service, wcCache.requestType, wcCache.requestKeyHash],
          set: {
            requestKey,
            outcome: 'failure',
            response: { error: error ?? null } as any,
            fetchedAt,
          },
          setWhere: sql`${wcCache.outcome} <> 'success' OR ${lt(wcCache.fetchedAt, keepSuccessNewerThan)}`,
        });
    },

    async canStore(): Promise<boolean> {
      const client = getClient();
      try {
        const result = await client.execute(
          sql`SELECT current_setting('transaction_read_only') AS read_only`,
        );
        const rows = (Array.isArray(result) ? result : (result as { rows?: unknown[] }).rows) ?? [];
        const value = (rows[0] as { read_only?: string } | undefined)?.read_only;
        return value === 'off';
      } catch {
        // Fail closed. The rule is "never make a billable request unless the
        // answer can be kept", and an unanswerable connection is not a yes.
        return false;
      }
    },

    async purgeExpired(expiries: WcCacheExpiry[]): Promise<number> {
      const client = getClient();
      let deleted = 0;
      for (const expiry of expiries) {
        const rows = await client
          .delete(wcCache)
          .where(expiryCondition(expiry))
          .returning({ id: wcCache.id });
        deleted += rows.length;
      }
      return deleted;
    },

    async countExpired(expiries: WcCacheExpiry[]): Promise<number> {
      const client = getClient();
      let total = 0;
      for (const expiry of expiries) {
        const [row] = await client
          .select({ count: sql<number>`count(*)::int` })
          .from(wcCache)
          .where(expiryCondition(expiry));
        total += Number(row?.count ?? 0);
      }
      return total;
    },

    async listRequestTypes(): Promise<Array<{ service: string; requestType: string; rows: number }>> {
      const client = getClient();
      const rows = await client
        .select({
          service: wcCache.service,
          requestType: wcCache.requestType,
          rows: sql<number>`count(*)::int`,
        })
        .from(wcCache)
        .groupBy(wcCache.service, wcCache.requestType);
      return rows.map((r) => ({ ...r, rows: Number(r.rows) }));
    },
  };
}

export const wcCacheStorage = createWcCacheStorage();

import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
import { allowInMaintenanceMode } from '../maintenance';
import { sessions } from "@shared/schema";
import { eq, sql } from "drizzle-orm";
import type { StorageLoggingConfig } from "../middleware/logging";

/**
 * Stub validator - add validation logic here when needed
 */
export const validate = createNoopValidator();

export interface SessionWithUser {
  sid: string;
  expire: Date;
  userId: string | null;
  userEmail: string | null;
  userFirstName: string | null;
  userLastName: string | null;
}

export interface SessionStorage {
  getSessions(): Promise<SessionWithUser[]>;
  /**
   * Delete one session row. Logged ("Deleted session ..."); the optional
   * `reason` (e.g. 'expired', 'logout') is included in the log description
   * so a session's lifecycle end is attributable. Omitted reason = manual
   * (admin) deletion.
   */
  deleteSession(sid: string, reason?: string): Promise<boolean>;

  countActiveSessions(): Promise<number>;
  /**
   * express-session store primitives (used by StorageSessionStore in
   * server/auth/session-store.ts). getSessionData/touchSession run on nearly
   * every HTTP request and are intentionally NOT logged. upsertSession is
   * logged ONLY when it actually inserts (session creation) via the
   * shouldLog predicate in sessionLoggingConfig.
   */
  /** The session payload for an unexpired session, or undefined. */
  getSessionData(sid: string): Promise<unknown | undefined>;
  /** Insert or replace a session row; reports whether a new row was inserted. */
  upsertSession(sid: string, sess: unknown, expire: Date): Promise<{ created: boolean }>;
  /** Roll a session's expiry forward. No-op when the row is gone. */
  touchSession(sid: string, expire: Date): Promise<void>;
  /** Sids of expired session rows (for per-session logged pruning). */
  getExpiredSessionSids(): Promise<string[]>;
  /**
   * Delete one session ONLY if it is still expired (atomic `sid AND
   * expire < now()` qualification, so a session renewed between the prune's
   * candidate scan and this delete survives). Logged only when it actually
   * deleted. Returns whether a row was removed.
   */
  deleteExpiredSession(sid: string): Promise<boolean>;
}

export function createSessionStorage(): SessionStorage {
  const storage: SessionStorage = {
    async getSessions(): Promise<SessionWithUser[]> {
      const client = getClient();
      const now = new Date();
      const result = await client.execute(sql`
        SELECT 
          s.sid,
          s.expire,
          u.id as user_id,
          u.email as user_email,
          u.first_name as user_first_name,
          u.last_name as user_last_name
        FROM sessions s
        LEFT JOIN users u ON u.id::text = (s.sess->'passport'->'user'->'dbUser'->>'id')
        WHERE s.expire > ${now}
        ORDER BY s.expire DESC
      `);
      
      return (result.rows as any[]).map(row => ({
        sid: row.sid,
        expire: new Date(row.expire),
        userId: row.user_id,
        userEmail: row.user_email,
        userFirstName: row.user_first_name,
        userLastName: row.user_last_name,
      }));
    },

    // Session writes are wrapped in allowInMaintenanceMode: login, rolling
    // expiry, and logout must keep working while the site is in maintenance
    // mode so admins can reach the system-mode escape route. This also
    // (deliberately) covers the session-prune cron (deleteExpiredSession) —
    // pruning during maintenance is harmless and keeps the table tidy.
    async deleteSession(sid: string, _reason?: string): Promise<boolean> {
      return allowInMaintenanceMode(async () => {
        const client = getClient();
        const result = await client
          .delete(sessions)
          .where(eq(sessions.sid, sid))
          .returning();
        return result.length > 0;
      });
    },

    async countActiveSessions(): Promise<number> {
      const client = getClient();
      const now = new Date();
      const [result] = await client
        .select({ count: sql<number>`count(*)` })
        .from(sessions)
        .where(sql`${sessions.expire} > ${now}`);
      return Number(result?.count ?? 0);
    },

    async getSessionData(sid: string): Promise<unknown | undefined> {
      const client = getClient();
      const now = new Date();
      const [row] = await client
        .select({ sess: sessions.sess })
        .from(sessions)
        .where(sql`${sessions.sid} = ${sid} AND ${sessions.expire} >= ${now}`)
        .limit(1);
      return row?.sess;
    },

    async upsertSession(sid: string, sess: unknown, expire: Date): Promise<{ created: boolean }> {
      return allowInMaintenanceMode(async () => {
        const client = getClient();
        // `xmax = 0` distinguishes insert from update in the same statement:
        // a freshly inserted row has no deleting/locking transaction recorded,
        // while ON CONFLICT UPDATE leaves xmax set. Single round-trip, atomic.
        const [row] = await client
          .insert(sessions)
          .values({ sid, sess, expire })
          .onConflictDoUpdate({
            target: sessions.sid,
            set: { sess, expire },
          })
          .returning({ created: sql<boolean>`(xmax = 0)` });
        return { created: row?.created === true };
      });
    },

    async touchSession(sid: string, expire: Date): Promise<void> {
      return allowInMaintenanceMode(async () => {
        const client = getClient();
        await client
          .update(sessions)
          .set({ expire })
          .where(eq(sessions.sid, sid));
      });
    },

    async getExpiredSessionSids(): Promise<string[]> {
      const client = getClient();
      const now = new Date();
      const rows = await client
        .select({ sid: sessions.sid })
        .from(sessions)
        .where(sql`${sessions.expire} < ${now}`);
      return rows.map((r) => r.sid);
    },

    async deleteExpiredSession(sid: string): Promise<boolean> {
      return allowInMaintenanceMode(async () => {
        const client = getClient();
        const now = new Date();
        const result = await client
          .delete(sessions)
          .where(sql`${sessions.sid} = ${sid} AND ${sessions.expire} < ${now}`)
          .returning({ sid: sessions.sid });
        return result.length > 0;
      });
    },

  };

  return storage;
}

/** Best-effort user id out of an express-session payload (passport shape). */
function sessionUserId(sess: any): string | undefined {
  const user = sess?.passport?.user;
  return user?.dbUser?.id ?? user?.claims?.sub ?? undefined;
}

export const sessionLoggingConfig: StorageLoggingConfig<SessionStorage> = {
  module: 'sessions',
  methods: {
    deleteSession: {
      enabled: true,
      getEntityId: (args) => args[0],
      getDescription: async (args) =>
        `Deleted session ${args[0]?.substring(0, 8)}...${args[1] ? ` (${args[1]})` : ''}`,
      after: async (args, result) => {
        return {
          deleted: result,
          metadata: {
            sid: args[0],
            ...(args[1] ? { reason: args[1] } : {}),
          }
        };
      }
    },
    upsertSession: {
      enabled: true,
      // Runs on every session save; only the initial insert (session
      // creation) is log-worthy. Mid-session data re-saves stay silent.
      shouldLog: (_args, result) => result?.created === true,
      // Never persist the raw session payload (cookies, passport identity,
      // potentially provider tokens) into the audit log — keep sid + expiry.
      logArgs: (args) => [args[0], "<session payload redacted>", args[2]],
      getEntityId: (args) => args[0],
      getDescription: async (args) => `Session created ${args[0]?.substring(0, 8)}...`,
      after: async (args, result) => {
        return {
          created: result?.created === true,
          metadata: {
            sid: args[0],
            userId: sessionUserId(args[1]) ?? null,
          }
        };
      }
    },
    deleteExpiredSession: {
      enabled: true,
      // Atomic expired-only delete used by the prune cron. Only log when a
      // row was actually removed (a renewed session survives silently).
      shouldLog: (_args, result) => result === true,
      getEntityId: (args) => args[0],
      getDescription: async (args) => `Deleted session ${args[0]?.substring(0, 8)}... (expired)`,
      after: async (args, result) => {
        return {
          deleted: result,
          metadata: {
            sid: args[0],
            reason: 'expired',
          }
        };
      }
    },
  },
};

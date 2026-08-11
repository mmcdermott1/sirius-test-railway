import { createNoopValidator } from '../utils/validation';
import { getClient } from '../transaction-context';
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
  deleteSession(sid: string): Promise<boolean>;
  countActiveSessions(): Promise<number>;
  /**
   * express-session store primitives (used by StorageSessionStore in
   * server/auth/session-store.ts). These run on nearly every HTTP request,
   * so they are intentionally NOT wrapped with per-operation diff logging
   * (see sessionLoggingConfig, which only logs deleteSession).
   */
  /** The session payload for an unexpired session, or undefined. */
  getSessionData(sid: string): Promise<unknown | undefined>;
  /** Insert or replace a session row. */
  upsertSession(sid: string, sess: unknown, expire: Date): Promise<void>;
  /** Roll a session's expiry forward. No-op when the row is gone. */
  touchSession(sid: string, expire: Date): Promise<void>;
  /** Delete expired session rows; returns how many were removed. */
  deleteExpiredSessions(): Promise<number>;
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

    async deleteSession(sid: string): Promise<boolean> {
      const client = getClient();
      const result = await client
        .delete(sessions)
        .where(eq(sessions.sid, sid))
        .returning();
      return result.length > 0;
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

    async upsertSession(sid: string, sess: unknown, expire: Date): Promise<void> {
      const client = getClient();
      await client
        .insert(sessions)
        .values({ sid, sess, expire })
        .onConflictDoUpdate({
          target: sessions.sid,
          set: { sess, expire },
        });
    },

    async touchSession(sid: string, expire: Date): Promise<void> {
      const client = getClient();
      await client
        .update(sessions)
        .set({ expire })
        .where(eq(sessions.sid, sid));
    },

    async deleteExpiredSessions(): Promise<number> {
      const client = getClient();
      const now = new Date();
      const result = await client
        .delete(sessions)
        .where(sql`${sessions.expire} < ${now}`)
        .returning({ sid: sessions.sid });
      return result.length;
    },

  };

  return storage;
}

export const sessionLoggingConfig: StorageLoggingConfig<SessionStorage> = {
  module: 'sessions',
  methods: {
    deleteSession: {
      enabled: true,
      getEntityId: (args) => args[0],
      getDescription: async (args) => `Deleted session ${args[0]?.substring(0, 8)}...`,
      after: async (args, result) => {
        return {
          deleted: result,
          metadata: {
            sid: args[0],
          }
        };
      }
    },
  },
};

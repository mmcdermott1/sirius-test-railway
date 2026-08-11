import { storage } from "../../../../storage";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

/**
 * Deletes expired rows from the `sessions` table. Replaces connect-pg-simple's
 * in-process pruneSessionInterval now that session persistence goes through
 * the storage layer (StorageSessionStore). Expired sessions are already
 * invisible to the store's `get` (it filters on expire), so pruning is pure
 * garbage collection.
 */
registerCronPlugin({
  metadata: {
    id: "session-prune",
    name: "Session Prune",
    description: "Deletes expired login sessions from the sessions table",
    singleton: true,
  },
  defaultSchedule: "*/15 * * * *", // Every 15 minutes (connect-pg-simple's default cadence)
  defaultEnabled: true,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    if (context.mode === "test") {
      const active = await storage.sessions.countActiveSessions();
      return {
        message: `Test mode: expired rows would be deleted; ${active} active sessions would be kept`,
        metadata: { activeSessions: active },
      };
    }

    const deleted = await storage.sessions.deleteExpiredSessions();
    return {
      message: `Deleted ${deleted} expired sessions`,
      metadata: { deleted },
    };
  },
});

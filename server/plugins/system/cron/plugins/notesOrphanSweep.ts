import { NOTE_ENTITY_TYPES } from "@shared/notes";
import { storage } from "../../../../storage";
import { registerCronPlugin } from "../registry";
import type { CronJobContext, CronJobResult } from "../types";

/** Max orphans removed per record type per run, so one sweep can't run long. */
const BATCH_LIMIT = 500;

/**
 * `notes_orphan_sweep` cron — deletes notes whose parent record is gone.
 *
 * `notes.entity_type` / `entity_id` are a polymorphic pair with no FK, so
 * deleting a worker, employer or provider leaves its notes behind. This job
 * runs one anti-join per record type registered in the shared note-entity
 * registry (`shared/notes.ts`) and hard-deletes what it finds. Because it
 * iterates the registry, a newly note-able record type is swept automatically
 * — nothing to add here. In `test` mode it reports what it would delete
 * without writing.
 */
registerCronPlugin({
  metadata: {
    id: "notes_orphan_sweep",
    name: "Notes Orphan Sweep",
    description:
      "Daily sweep that deletes notes whose parent record (worker, employer, trust provider, …) no longer exists.",
    singleton: true,
  },
  defaultSchedule: "45 3 * * *", // Daily at 03:45
  defaultEnabled: true,

  async execute(context: CronJobContext): Promise<CronJobResult> {
    const perEntityType: Array<{ entityType: string; orphans: number; deleted: number }> = [];
    let totalDeleted = 0;
    let totalFound = 0;

    for (const entityType of NOTE_ENTITY_TYPES) {
      const orphanIds = await storage.notes.findOrphanIds(entityType.id, BATCH_LIMIT);
      totalFound += orphanIds.length;

      let deleted = 0;
      if (context.mode === "live" && orphanIds.length > 0) {
        deleted = await storage.notes.deleteByIds(orphanIds);
        totalDeleted += deleted;
      }
      perEntityType.push({ entityType: entityType.id, orphans: orphanIds.length, deleted });
    }

    const verb = context.mode === "live" ? "Deleted" : "Would delete";
    const count = context.mode === "live" ? totalDeleted : totalFound;
    return {
      message: `${verb} ${count} orphaned note${count === 1 ? "" : "s"} across ${perEntityType.length} record types`,
      metadata: { totalFound, totalDeleted, perEntityType },
    };
  },
});

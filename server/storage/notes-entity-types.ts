import { workers, employers, trustProviders } from "@shared/schema";
import { NOTE_ENTITY_TYPES } from "@shared/notes";
import type { PgTable, TableConfig } from "drizzle-orm/pg-core";

/**
 * Server-side half of the note-entity registry: maps each note-able record
 * type declared in `shared/notes.ts` to the table that holds it.
 *
 * This is the ONLY place a note-able record type is bound to a table. The
 * existence check on save and the orphan sweep both drive off this map, so a
 * new note-able type is one entry here plus one entry in the shared registry.
 */
export const noteEntityTables: Record<string, PgTable<TableConfig>> = {
  worker: workers,
  employer: employers,
  trust_provider: trustProviders,
};

/**
 * Registered note-able types that have a table binding. Anything declared in
 * the shared registry but missing from `noteEntityTables` is a wiring bug —
 * `assertNoteEntityTablesComplete` fails fast on it at boot rather than
 * letting the sweep silently skip that type's orphans.
 */
export function assertNoteEntityTablesComplete(): void {
  const missing = NOTE_ENTITY_TYPES.filter((t) => !noteEntityTables[t.id]).map((t) => t.id);
  if (missing.length > 0) {
    throw new Error(
      `Note entity types missing a table binding in server/storage/notes-entity-types.ts: ${missing.join(", ")}`,
    );
  }
}

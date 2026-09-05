import {
  snapshots,
  entityMetadata,
  users,
  type Snapshot,
  type InsertSnapshot,
} from "@shared/schema";
import type { SnapshotMeta } from "@shared/snapshots";
import { eq, and, desc, inArray } from "drizzle-orm";
import { getClient } from "../transaction-context";
import { defineLoggingConfig } from "../middleware/logging";

/**
 * The raw table these records live in. Named once: the logging config declares
 * it so the framework files each snapshot's provenance under it, and the reads
 * below join on the same name so a provenance row filed under some other table
 * can never answer for a snapshot.
 */
const SNAPSHOTS_TABLE = "snapshots";

/**
 * When a snapshot was captured, and by whom, from the record's history.
 *
 * The snapshot row itself no longer carries either — `entity_metadata` answers
 * both, for every logged table at once (see `docs/provenance-columns.md`), and
 * it is read here as a join rather than a lookup per row because these are
 * list reads. Both halves are nullable, and each null is a real answer:
 *
 *  - no history yet (best effort, written just after the capturing save
 *    commits), so no date; and
 *  - no person, either because the capture had no signed-in user behind it or
 *    because the account has since been deleted.
 */
export interface SnapshotProvenance {
  capturedAt: Date | null;
  /** Resolved from the account at read time, so a rename shows through. */
  capturedByName: string | null;
}

/** A full snapshot row (payload included) with the history the framework holds. */
export type SnapshotWithProvenance = Snapshot & SnapshotProvenance;

export interface SnapshotsStorage {
  create(snapshot: InsertSnapshot): Promise<Snapshot>;
  /** Metadata only (no data payload), newest first. */
  listByEntity(entityType: string, entityId: string): Promise<SnapshotMeta[]>;
  /**
   * Bulk "most recent snapshot id" lookup, keyed by entity id. Entities with
   * no snapshot at all are simply absent from the map — snapshots are only
   * captured on qualifying events, so having none is normal.
   */
  getLatestIdsByEntity(entityType: string, entityIds: string[]): Promise<Map<string, string>>;
  /**
   * One page of an entity's full snapshots (payload included), newest first:
   * `limit` rows starting at `offset`. Paging exists so a caller searching
   * backwards through history for a particular earlier state can walk it to
   * the end — a page that comes back short is the end — without holding the
   * whole history in memory at once.
   *
   * `capturedAt` orders WRITES. A caller that needs to place a snapshot
   * relative to a particular save should read the save's own identity out of
   * the captured bundle rather than infer it from this ordering.
   */
  listRecent(
    entityType: string,
    entityId: string,
    limit: number,
    offset?: number,
  ): Promise<SnapshotWithProvenance[]>;
  get(id: string): Promise<SnapshotWithProvenance | undefined>;
  delete(id: string): Promise<boolean>;
}

/**
 * Display name from the joined account: "First Last", falling back to
 * whichever half exists, then the email. Restated here rather than imported
 * for the same reason `../system/entity-metadata.ts` restates it — that module
 * is a leaf the logging middleware imports, so it exports no helpers.
 */
function personName(row: {
  firstName: string | null;
  lastName: string | null;
  email: string | null;
}): string | null {
  const part = (value: string | null) =>
    typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  const full = [part(row.firstName), part(row.lastName)].filter(Boolean).join(" ");
  return full || part(row.email);
}

export function createSnapshotsStorage(): SnapshotsStorage {
  /**
   * A snapshot's own columns plus the provenance pair, ready to select.
   *
   * The join is on the snapshot's OWN id — the framework keys provenance by
   * the record's id — and is guarded by the table name so a row belonging to
   * some other record's table cannot answer for a snapshot.
   */
  const provenanceColumns = {
    capturedAt: entityMetadata.createdDate,
    capturedByFirstName: users.firstName,
    capturedByLastName: users.lastName,
    capturedByEmail: users.email,
  };

  /**
   * Newest first. A snapshot whose history has not landed yet sorts FIRST
   * (Postgres orders NULLs first on a descending sort), which is where a row
   * written moments ago belongs; the snapshot's own id settles ties so a page
   * boundary is stable.
   */
  const newestFirst = [desc(entityMetadata.createdDate), desc(snapshots.id)];

  return {
    async create(insertSnapshot: InsertSnapshot): Promise<Snapshot> {
      const client = getClient();
      const [row] = await client.insert(snapshots).values(insertSnapshot).returning();
      return row;
    },

    async listByEntity(entityType: string, entityId: string): Promise<SnapshotMeta[]> {
      const client = getClient();
      const rows = await client
        .select({
          id: snapshots.id,
          entityType: snapshots.entityType,
          entityId: snapshots.entityId,
          label: snapshots.label,
          ...provenanceColumns,
        })
        .from(snapshots)
        .leftJoin(
          entityMetadata,
          and(
            eq(entityMetadata.entityId, snapshots.id),
            eq(entityMetadata.tableName, SNAPSHOTS_TABLE),
          ),
        )
        .leftJoin(users, eq(users.id, entityMetadata.createdBy))
        .where(and(eq(snapshots.entityType, entityType), eq(snapshots.entityId, entityId)))
        .orderBy(...newestFirst);
      return rows.map((row) => ({
        id: row.id,
        entityType: row.entityType,
        entityId: row.entityId,
        label: row.label,
        capturedAt: row.capturedAt ? row.capturedAt.toISOString() : null,
        capturedByName: personName({
          firstName: row.capturedByFirstName,
          lastName: row.capturedByLastName,
          email: row.capturedByEmail,
        }),
      }));
    },

    async getLatestIdsByEntity(entityType: string, entityIds: string[]): Promise<Map<string, string>> {
      if (entityIds.length === 0) return new Map();
      const client = getClient();
      const rows = await client
        .selectDistinctOn([snapshots.entityId], {
          entityId: snapshots.entityId,
          id: snapshots.id,
        })
        .from(snapshots)
        .leftJoin(
          entityMetadata,
          and(
            eq(entityMetadata.entityId, snapshots.id),
            eq(entityMetadata.tableName, SNAPSHOTS_TABLE),
          ),
        )
        .where(and(eq(snapshots.entityType, entityType), inArray(snapshots.entityId, entityIds)))
        .orderBy(snapshots.entityId, ...newestFirst);
      return new Map(rows.map((row) => [row.entityId, row.id]));
    },

    async listRecent(
      entityType: string,
      entityId: string,
      limit: number,
      offset = 0,
    ): Promise<SnapshotWithProvenance[]> {
      const client = getClient();
      const rows = await client
        .select({
          id: snapshots.id,
          entityType: snapshots.entityType,
          entityId: snapshots.entityId,
          label: snapshots.label,
          data: snapshots.data,
          ...provenanceColumns,
        })
        .from(snapshots)
        .leftJoin(
          entityMetadata,
          and(
            eq(entityMetadata.entityId, snapshots.id),
            eq(entityMetadata.tableName, SNAPSHOTS_TABLE),
          ),
        )
        .leftJoin(users, eq(users.id, entityMetadata.createdBy))
        .where(
          and(eq(snapshots.entityType, entityType), eq(snapshots.entityId, entityId)),
        )
        .orderBy(...newestFirst)
        .limit(limit)
        .offset(offset);
      return rows.map(toSnapshotWithProvenance);
    },

    async get(id: string): Promise<SnapshotWithProvenance | undefined> {
      const client = getClient();
      const [row] = await client
        .select({
          id: snapshots.id,
          entityType: snapshots.entityType,
          entityId: snapshots.entityId,
          label: snapshots.label,
          data: snapshots.data,
          ...provenanceColumns,
        })
        .from(snapshots)
        .leftJoin(
          entityMetadata,
          and(
            eq(entityMetadata.entityId, snapshots.id),
            eq(entityMetadata.tableName, SNAPSHOTS_TABLE),
          ),
        )
        .leftJoin(users, eq(users.id, entityMetadata.createdBy))
        .where(eq(snapshots.id, id));
      return row ? toSnapshotWithProvenance(row) : undefined;
    },

    async delete(id: string): Promise<boolean> {
      const client = getClient();
      const result = await client.delete(snapshots).where(eq(snapshots.id, id)).returning();
      return result.length > 0;
    },
  };
}

/** One joined row as the rest of the app sees it: the record, plus its history. */
function toSnapshotWithProvenance(row: {
  id: string;
  entityType: string;
  entityId: string;
  label: string | null;
  data: unknown;
  capturedAt: Date | null;
  capturedByFirstName: string | null;
  capturedByLastName: string | null;
  capturedByEmail: string | null;
}): SnapshotWithProvenance {
  return {
    id: row.id,
    entityType: row.entityType,
    entityId: row.entityId,
    label: row.label,
    data: row.data,
    capturedAt: row.capturedAt,
    capturedByName: personName({
      firstName: row.capturedByFirstName,
      lastName: row.capturedByLastName,
      email: row.capturedByEmail,
    }),
  };
}

export const snapshotsLoggingConfig = defineLoggingConfig<SnapshotsStorage>({
  module: 'snapshots',
  table: SNAPSHOTS_TABLE,
  methods: {
    // `create` names the capture as the record's CREATION (the framework reads
    // that off the method name), and creation is the only write that stamps a
    // person: the effective user behind the request, or nobody when the
    // capture came from a system path with no request behind it. Provenance is
    // filed under the snapshot's own id — `getHostEntityId` names the CAPTURED
    // entity, which is where the log entry shows up, not whose record this is.
    create: {
      state: { fallbackId: 'new snapshot' },
      getHostEntityId: (args, result) => result?.entityId || args[0]?.entityId,
      getDescription: async (args, result) => {
        const entityType = result?.entityType || args[0]?.entityType || 'unknown';
        const label = result?.label || args[0]?.label || '';
        return `Captured snapshot of ${entityType}${label ? ` [${label}]` : ''}`;
      },
    },
  },
});

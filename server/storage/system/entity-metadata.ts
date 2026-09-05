import { sql } from "drizzle-orm";
import { getClient } from "../transaction-context";
import { storageLogger } from "../../logger";

/**
 * Provenance rows for the `entity_metadata` table: one row per record, keyed
 * by the record's own id.
 *
 * Everything here is **best effort**. The storage logging middleware calls
 * these after the mutation has already returned, outside the caller's
 * transaction, and swallows failures — a metadata row that never gets written
 * costs nothing but the metadata.
 *
 * Two properties this module protects, because nothing else can:
 *
 *  - **`seq` permanently names one record.** `table_name` is written once, at
 *    insert, and never rewritten. A write naming a different table for an id
 *    we already know is refused and reported rather than applied.
 *  - **Stamps only move forward.** Callers are deferred and unordered, so a
 *    write carrying an older timestamp than the row already holds must not
 *    win. The comparison happens in SQL, so concurrent writers racing on the
 *    same row still settle on the newest.
 *
 * This module is deliberately NOT wrapped in storage logging: it is the thing
 * logging calls.
 */

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Whether an id is shaped like the record ids this table indexes.
 *
 * Log entries carry an `entity_id` that is only *usually* the record's own id
 * — some configs report a parent's id, a placeholder ("new address"), or a
 * batch summary ("batch of 12"). Filing those under `entity_id` would attach
 * one record's provenance to another's, so anything that is not a UUID is
 * dropped before it reaches the table.
 */
export function isRecordId(value: unknown): value is string {
  return typeof value === "string" && UUID_PATTERN.test(value);
}

/**
 * Whether a write may proceed for this id, reporting the ones that look like
 * a mistake. An absent id means the caller had nothing to offer (an error
 * path, a method that identifies nothing) and is passed over in silence; a
 * *present* id that is not a record id is a mislabeled logging config, and
 * says so.
 */
function acceptsId(
  entityId: unknown,
  tableName: string,
  operation: string,
): entityId is string {
  if (isRecordId(entityId)) return true;
  if (typeof entityId === "string" && entityId.trim() !== "") {
    reportRefusal("logged entity id is not a record id", {
      entityId,
      tableName,
      operation,
    });
  }
  return false;
}

export interface EntityMetadataTouch {
  /** Raw database table the record lives in. */
  tableName: string;
  /** The record's own id. */
  entityId: string;
  /** When the mutation completed — captured at the call site, not here. */
  at: Date;
  /** Effective acting user, or null for work with no request behind it. */
  actorId?: string | null;
}

/** One date/person pair, as read back for display. */
export interface EntityMetadataStamp {
  date: Date | null;
  /** Display name of the person, or null when nobody was recorded. */
  personName: string | null;
}

/** A record's provenance, with the people it names resolved to display names. */
export interface EntityMetadataView {
  seq: number;
  tableName: string;
  entityId: string;
  created: EntityMetadataStamp;
  modified: EntityMetadataStamp;
  subrecordModified: EntityMetadataStamp;
}

export interface EntityMetadataStorage {
  /**
   * One record's provenance, or undefined when nothing has been recorded for
   * it — which is the normal state for every record that predates this
   * framework and has not been touched since.
   *
   * This is the module's ONLY read, and it has no write counterpart beyond
   * the system-maintained ones below: provenance is written by the mutation
   * that caused it and by nothing else.
   */
  get(entityId: string): Promise<EntityMetadataView | undefined>;

  /**
   * Record a mutation OF the record itself.
   *
   * `created` marks the mutation as the record's creation, which is the only
   * way `created_by` is ever filled in: a record first met mid-life gets a
   * `created_date` (the first sighting, an upper bound on the real creation)
   * but no creator, because we did not see who made it.
   */
  recordMutation(touch: EntityMetadataTouch & { created?: boolean }): Promise<void>;

  /**
   * Record a mutation of one of the record's CHILDREN. Advances only the
   * `subrecord_modified_*` pair — the record itself did not change.
   */
  recordSubrecordTouch(touch: EntityMetadataTouch): Promise<void>;

  /**
   * Forget a record. Its `seq` goes with it; a record re-created under the
   * same id would be a different entity and gets a new one.
   */
  recordDeletion(input: Pick<EntityMetadataTouch, "tableName" | "entityId">): Promise<void>;
}

/**
 * Report a write we refused. Goes to `storageLogger` rather than the app
 * logger so it reaches the admin log viewer — a refusal means some caller is
 * handing over the wrong id, which is a defect someone has to see. No
 * recursion risk: this module is never itself logged.
 */
function reportRefusal(reason: string, detail: Record<string, unknown>): void {
  storageLogger.warn(`Entity metadata: ${reason}`, {
    module: "entityMetadata",
    operation: "refused",
    description: reason,
    meta: detail,
  });
}

/**
 * The work in flight for one record. Maintenance for a given id runs one
 * operation at a time, in the order the operations reached this module.
 *
 * The callers are deferred and unordered: an edit and the delete that follows
 * it can arrive here in either order, and two statements racing in the
 * database settle by whichever lands last — a deleted record's row
 * resurrected, or a live record's row missing. Ordering the work per id
 * inside the process removes the race in the case that produces it (both
 * mutations came from this process), and lets a deletion speak for the whole
 * window: once a record is forgotten, writes still queued behind it are for a
 * record that no longer exists and are dropped.
 *
 * The entry is discarded as soon as its queue drains, so this holds only the
 * ids currently being written.
 */
interface EntityQueue {
  /** Resolves when the last operation queued so far has finished. */
  tail: Promise<void>;
  /** Operations queued and not yet finished. */
  outstanding: number;
  /** A deletion has run in this window. */
  forgotten: boolean;
}

const queues = new Map<string, EntityQueue>();

function serialize(
  entityId: string,
  run: (queue: EntityQueue) => Promise<void>,
): Promise<void> {
  const queue: EntityQueue = queues.get(entityId) ?? {
    tail: Promise.resolve(),
    outstanding: 0,
    forgotten: false,
  };
  queues.set(entityId, queue);
  queue.outstanding += 1;

  const finished = queue.tail.then(() => run(queue));
  // The chain must survive a failed operation, so the queue's own handle on it
  // ignores the rejection; the caller still receives it.
  queue.tail = finished.then(
    () => undefined,
    () => undefined,
  );
  return finished.finally(() => {
    queue.outstanding -= 1;
    if (queue.outstanding === 0 && queues.get(entityId) === queue) {
      queues.delete(entityId);
    }
  });
}

/**
 * Display name from a joined user row: "First Last", falling back to whichever
 * half exists, then the email.
 *
 * The notes module states the same rule, and this one deliberately restates it
 * rather than importing it: everything in this file has to stay a leaf, since
 * the logging middleware imports it and the notes module imports the logging
 * middleware.
 */
function personNameFrom(row: Record<string, unknown>, prefix: string): string | null {
  const part = (key: string) => {
    const value = row[`${prefix}_${key}`];
    return typeof value === "string" && value.trim() !== "" ? value.trim() : null;
  };
  const full = [part("first_name"), part("last_name")].filter(Boolean).join(" ");
  if (full) return full;
  return part("email");
}

function stampFrom(
  row: Record<string, unknown>,
  dateColumn: string,
  personPrefix: string,
): EntityMetadataStamp {
  const raw = row[dateColumn];
  const date =
    raw instanceof Date ? raw : typeof raw === "string" ? new Date(raw) : null;
  return { date, personName: personNameFrom(row, personPrefix) };
}

export function createEntityMetadataStorage(): EntityMetadataStorage {
  /**
   * Report the table disagreement behind a no-op upsert. Only reached when the
   * conflict path's guard rejected the write, so the extra read costs nothing
   * on the normal path.
   */
  async function reportTableMismatch(
    tableName: string,
    entityId: string,
  ): Promise<void> {
    const client = getClient();
    const existing = await client.execute(
      sql`SELECT table_name FROM entity_metadata WHERE entity_id = ${entityId}`,
    );
    const held = existing.rows?.[0]?.table_name;
    reportRefusal("record id already belongs to another table", {
      entityId,
      declaredTable: tableName,
      storedTable: held ?? null,
    });
  }

  return {
    async get(entityId) {
      if (!isRecordId(entityId)) return undefined;
      const client = getClient();
      const result = await client.execute(sql`
        SELECT
          m.seq, m.table_name, m.entity_id,
          m.created_date, m.modified_date, m.subrecord_modified_date,
          cu.first_name AS created_first_name,
          cu.last_name  AS created_last_name,
          cu.email      AS created_email,
          mu.first_name AS modified_first_name,
          mu.last_name  AS modified_last_name,
          mu.email      AS modified_email,
          su.first_name AS subrecord_first_name,
          su.last_name  AS subrecord_last_name,
          su.email      AS subrecord_email
        FROM entity_metadata m
        LEFT JOIN users cu ON cu.id = m.created_by
        LEFT JOIN users mu ON mu.id = m.modified_by
        LEFT JOIN users su ON su.id = m.subrecord_modified_by
        WHERE m.entity_id = ${entityId}
      `);
      const row = result.rows?.[0] as Record<string, unknown> | undefined;
      if (!row) return undefined;
      return {
        seq: Number(row.seq),
        tableName: String(row.table_name),
        entityId: String(row.entity_id),
        created: stampFrom(row, "created_date", "created"),
        modified: stampFrom(row, "modified_date", "modified"),
        subrecordModified: stampFrom(row, "subrecord_modified_date", "subrecord"),
      };
    },

    async recordMutation({ tableName, entityId, at, actorId, created }) {
      if (!acceptsId(entityId, tableName, "mutation")) return;
      return serialize(entityId, async (queue) => {
        if (queue.forgotten) return;
        const client = getClient();
        const createdBy = created ? (actorId ?? null) : null;
        const result = await client.execute(sql`
          INSERT INTO entity_metadata (
            table_name, entity_id,
            created_date, created_by,
            modified_date, modified_by
          )
          VALUES (
            ${tableName}, ${entityId},
            ${at}, ${createdBy},
            ${at}, ${actorId ?? null}
          )
          ON CONFLICT (entity_id) DO UPDATE SET
            created_date = LEAST(entity_metadata.created_date, EXCLUDED.created_date),
            created_by = COALESCE(entity_metadata.created_by, EXCLUDED.created_by),
            modified_date = GREATEST(entity_metadata.modified_date, EXCLUDED.modified_date),
            modified_by = CASE
              WHEN entity_metadata.modified_date IS NULL
                OR entity_metadata.modified_date <= EXCLUDED.modified_date
              THEN EXCLUDED.modified_by
              ELSE entity_metadata.modified_by
            END
          WHERE entity_metadata.table_name = EXCLUDED.table_name
          RETURNING id
        `);
        if ((result.rowCount ?? result.rows?.length ?? 0) === 0) {
          await reportTableMismatch(tableName, entityId);
        }
      });
    },

    async recordSubrecordTouch({ tableName, entityId, at, actorId }) {
      if (!acceptsId(entityId, tableName, "subrecord touch")) return;
      return serialize(entityId, async (queue) => {
        if (queue.forgotten) return;
        const client = getClient();
        const result = await client.execute(sql`
          INSERT INTO entity_metadata (
            table_name, entity_id,
            created_date,
            subrecord_modified_date, subrecord_modified_by
          )
          VALUES (
            ${tableName}, ${entityId},
            ${at},
            ${at}, ${actorId ?? null}
          )
          ON CONFLICT (entity_id) DO UPDATE SET
            created_date = LEAST(entity_metadata.created_date, EXCLUDED.created_date),
            subrecord_modified_date = GREATEST(
              entity_metadata.subrecord_modified_date,
              EXCLUDED.subrecord_modified_date
            ),
            subrecord_modified_by = CASE
              WHEN entity_metadata.subrecord_modified_date IS NULL
                OR entity_metadata.subrecord_modified_date <= EXCLUDED.subrecord_modified_date
              THEN EXCLUDED.subrecord_modified_by
              ELSE entity_metadata.subrecord_modified_by
            END
          WHERE entity_metadata.table_name = EXCLUDED.table_name
          RETURNING id
        `);
        if ((result.rowCount ?? result.rows?.length ?? 0) === 0) {
          await reportTableMismatch(tableName, entityId);
        }
      });
    },

    async recordDeletion({ tableName, entityId }) {
      if (!acceptsId(entityId, tableName, "deletion")) return;
      return serialize(entityId, async (queue) => {
          // Anything still queued for this id is a write about a record that no
          // longer exists.
          queue.forgotten = true;
          const client = getClient();
          await client.execute(sql`
            DELETE FROM entity_metadata
            WHERE entity_id = ${entityId} AND table_name = ${tableName}
          `);
      });
    },
  };
}

/**
 * The one instance. Held here rather than on `IStorage` because its only
 * caller is the logging middleware, which `database.ts` imports — reaching
 * back through the composed storage object would be a cycle.
 */
export const entityMetadataStorage = createEntityMetadataStorage();

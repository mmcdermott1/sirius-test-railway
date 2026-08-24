import { getClient } from '../transaction-context';
import {
  workerAat,
  type WorkerAat,
} from "@shared/schema";
import { eq } from "drizzle-orm";
import { defineLoggingConfig } from "../middleware/logging";

/**
 * Storage for the `worker.aat` component's single per-worker access-token row.
 *
 * The table holds at most one row per worker (named unique on `worker_id`),
 * so every write is a create-or-update keyed by worker rather than by row id.
 */
export interface WorkerAatStorage {
  /** The worker's access-token row, or undefined when none has been issued. */
  getByWorker(workerId: string): Promise<WorkerAat | undefined>;
  /** Create-or-update: set (or replace) the worker's access UUID. */
  setAccessUuid(workerId: string, accessUuid: string): Promise<WorkerAat>;
  /** Create-or-update: set (or replace) the worker's access code. */
  setAccessCode(workerId: string, accessCode: string): Promise<WorkerAat>;
  /** Clear the worker's access code. Undefined when the worker has no row. */
  clearAccessCode(workerId: string): Promise<WorkerAat | undefined>;
}

async function workerName(workerId: string | undefined): Promise<string> {
  const { storage } = await import('../index');
  return storage.workers.getWorkerDisplayName(workerId);
}

/**
 * Audit-safe projection of a row.
 *
 * The access UUID and the access code are bearer-like credentials: a future
 * access link is authorized by the UUID alone. Everything the logging
 * middleware records — `meta.args`, `meta.before`, `meta.after` and the
 * `meta.changes` diff derived from them — is persisted to `winston_logs` and
 * readable through the admin log viewer, so none of those payloads may carry
 * the literal values. Anyone who could read them could mint a working link
 * for a worker they are not allowed to act for.
 *
 * What survives is what the audit trail actually needs: which row, which
 * worker, and whether each value was present. That is enough for
 * `meta.changes` to show a set/cleared/replaced transition without ever
 * disclosing the credential itself.
 */
interface RedactedWorkerAat {
  id: string;
  workerId: string;
  hasAccessCode: boolean;
  hasAccessUuid: boolean;
}

function redactRecord(row: WorkerAat | undefined): RedactedWorkerAat | undefined {
  if (!row) return undefined;
  return {
    id: row.id,
    workerId: row.workerId,
    hasAccessCode: row.accessCode !== null && row.accessCode !== undefined,
    hasAccessUuid: row.accessUuid !== null && row.accessUuid !== undefined,
  };
}

/** Keep the worker id (it identifies the audited entity); drop the value. */
const redactValueArg = (args: any[]) => [args[0], '[REDACTED]'];

interface BeforeState {
  record?: RedactedWorkerAat;
}

/**
 * The middleware hands `getDescription` the very object it persists, so the
 * before/after hooks project to the redacted shape rather than the raw row —
 * there is no variant of these payloads that holds a literal value. The
 * presence booleans are all the descriptions need to tell a first-time issue
 * from a replacement.
 *
 * These hooks have to be spelled out at all because the synthesized ones only
 * apply to `create*`/`update*`/`delete*` method names. Without an explicit
 * `before`, `beforeState` is always undefined and every line would claim
 * "Generated" / "Set" even on a replacement.
 */
const captureBefore = async (args: any[], storage: WorkerAatStorage): Promise<BeforeState> => ({
  record: redactRecord(await storage.getByWorker(args[0])),
});

const captureAfter = async (_args: any[], result: WorkerAat | undefined): Promise<BeforeState> => ({
  record: redactRecord(result),
});

const entityId = (args: any[], result: WorkerAat | undefined, before: unknown) =>
  result?.id ?? (before as BeforeState | undefined)?.record?.id ?? args[0];

export const workerAatLoggingConfig = defineLoggingConfig<WorkerAatStorage>({
  module: 'worker-aat',
  state: { key: 'record' },
  methods: {
    setAccessUuid: {
      logArgs: redactValueArg,
      before: captureBefore,
      after: captureAfter,
      getEntityId: entityId,
      getHostEntityId: (args) => args[0],
      getDescription: async (args, _result, beforeState: BeforeState | undefined) => {
        const name = await workerName(args[0]);
        return beforeState?.record?.hasAccessUuid
          ? `Regenerated access UUID for ${name}`
          : `Generated access UUID for ${name}`;
      },
    },
    setAccessCode: {
      logArgs: redactValueArg,
      before: captureBefore,
      after: captureAfter,
      getEntityId: entityId,
      getHostEntityId: (args) => args[0],
      getDescription: async (args, _result, beforeState: BeforeState | undefined) => {
        const name = await workerName(args[0]);
        return beforeState?.record?.hasAccessCode
          ? `Changed access code for ${name}`
          : `Set access code for ${name}`;
      },
    },
    clearAccessCode: {
      // Takes no secret argument, so args need no projection.
      before: captureBefore,
      after: captureAfter,
      getEntityId: entityId,
      getHostEntityId: (args) => args[0],
      getDescription: async (args) => `Cleared access code for ${await workerName(args[0])}`,
    },
  },
});

export function createWorkerAatStorage(): WorkerAatStorage {
  async function upsert(
    workerId: string,
    values: { accessUuid?: string | null; accessCode?: string | null },
  ): Promise<WorkerAat> {
    const client = getClient();
    const [row] = await client
      .insert(workerAat)
      .values({ workerId, ...values })
      .onConflictDoUpdate({
        target: workerAat.workerId,
        set: values,
      })
      .returning();
    return row;
  }

  return {
    async getByWorker(workerId: string): Promise<WorkerAat | undefined> {
      const client = getClient();
      const [row] = await client
        .select()
        .from(workerAat)
        .where(eq(workerAat.workerId, workerId))
        .limit(1);
      return row;
    },

    async setAccessUuid(workerId: string, accessUuid: string): Promise<WorkerAat> {
      return upsert(workerId, { accessUuid });
    },

    async setAccessCode(workerId: string, accessCode: string): Promise<WorkerAat> {
      return upsert(workerId, { accessCode });
    },

    async clearAccessCode(workerId: string): Promise<WorkerAat | undefined> {
      const client = getClient();
      const [row] = await client
        .update(workerAat)
        .set({ accessCode: null })
        .where(eq(workerAat.workerId, workerId))
        .returning();
      return row;
    },
  };
}

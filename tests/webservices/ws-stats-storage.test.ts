/**
 * The inbound call counter's storage: how a count is written, and how the
 * range reads roll up.
 *
 * Two properties are worth pinning down here and are cheap to lose in a later
 * edit. First, the write is a single insert-or-increment against the named
 * uniqueness constraint — the moment it becomes a read-then-write, two calls
 * arriving together silently collapse into one. Second, every coarser
 * breakdown is a roll-up of one range query rather than a second, coarser
 * question put to the table; two screens that ask separately can quietly
 * disagree about which calls fall in the window.
 *
 * The database is stubbed. That is the point for the roll-ups (they are pure
 * arithmetic over rows) and a deliberate limit for the write: this proves the
 * statement's *shape*, not Postgres's behavior under real concurrency, which
 * follows from the constraint the shape targets — asserted here against the
 * schema declaration so the two cannot drift.
 */
import { getTableConfig } from 'drizzle-orm/pg-core';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { wsStats } from '@shared/schema';

/** Rows the stubbed range query will return. */
let rangeRows: Array<{ pluginId: string; clientId: string; operation: string; calls: number }> = [];
/** What `recordCall` handed to the database, if anything. */
let write: { values?: any; conflict?: any } = {};
const selectSpy = vi.fn();

function stubConnection() {
  const chain: any = {};
  chain.select = (...args: unknown[]) => {
    selectSpy(...args);
    return chain;
  };
  chain.from = () => chain;
  chain.where = () => chain;
  chain.groupBy = () => chain;
  chain.orderBy = () => Promise.resolve(rangeRows);
  chain.insert = () => ({
    values: (values: unknown) => {
      write.values = values;
      return {
        onConflictDoUpdate: (conflict: unknown) => {
          write.conflict = conflict;
          return Promise.resolve();
        },
      };
    },
  });
  return chain;
}

vi.mock('../../server/storage/transaction-context', () => ({
  getClient: () => stubConnection(),
}));

const { createWsStatsStorage } = await import('../../server/storage/ws-stats');

const storage = createWsStatsStorage();
const RANGE = { start: '2026-08-01', end: '2026-08-31' };

beforeEach(() => {
  rangeRows = [];
  write = {};
  selectSpy.mockClear();
});

describe('counting a call', () => {
  it('is one insert-or-increment, never a read-then-write', async () => {
    await storage.recordCall('ping-v1', 'client-1', 'ping', '2026-08-31');

    expect(write.values).toEqual({
      pluginId: 'ping-v1',
      clientId: 'client-1',
      operation: 'ping',
      ymd: '2026-08-31',
      calls: 1,
    });
    // Nothing was read first. A read-then-write loses a count whenever two
    // calls interleave between the read and the write.
    expect(selectSpy).not.toHaveBeenCalled();
    // And the update is relative, not a value computed in JavaScript.
    expect(String(write.conflict.set.calls)).toBeTruthy();
    expect(write.conflict.set.calls).toHaveProperty('queryChunks');
  });

  it('targets exactly the columns the unique constraint covers', () => {
    // The conflict target and the constraint have to be the same tuple: a
    // conflict target Postgres cannot match an index for is an error, and a
    // constraint narrower than the target would merge counts that belong to
    // different callers.
    const { uniqueConstraints } = getTableConfig(wsStats);
    expect(uniqueConstraints).toHaveLength(1);
    expect(uniqueConstraints[0].name).toBe('ws_stats_plugin_client_operation_ymd_uniq');
    expect(uniqueConstraints[0].columns.map((column) => column.name)).toEqual([
      'plugin_id',
      'client_id',
      'operation',
      'ymd',
    ]);
  });

  it('conflicts on those same columns', async () => {
    await storage.recordCall('ping-v1', 'client-1', 'ping', '2026-08-31');

    expect(write.conflict.target).toEqual([
      wsStats.pluginId,
      wsStats.clientId,
      wsStats.operation,
      wsStats.ymd,
    ]);
  });
});

describe('reading a range', () => {
  beforeEach(() => {
    rangeRows = [
      { pluginId: 'edls', clientId: 'partner-a', operation: 'accept', calls: 3 },
      { pluginId: 'edls', clientId: 'partner-a', operation: 'decline', calls: 1 },
      { pluginId: 'edls', clientId: 'partner-b', operation: 'accept', calls: 5 },
      { pluginId: 'roster', clientId: 'partner-b', operation: 'sync', calls: 2 },
    ];
  });

  it('groups by plugin and operation, summing across clients', async () => {
    expect(await storage.countsByPluginOperation(RANGE)).toEqual([
      { pluginId: 'edls', operation: 'accept', calls: 8 },
      { pluginId: 'edls', operation: 'decline', calls: 1 },
      { pluginId: 'roster', operation: 'sync', calls: 2 },
    ]);
  });

  it('groups by plugin', async () => {
    expect(await storage.countsByPlugin(RANGE)).toEqual([
      { pluginId: 'edls', calls: 9 },
      { pluginId: 'roster', calls: 2 },
    ]);
  });

  it('groups by client', async () => {
    expect(await storage.countsByClient(RANGE)).toEqual([
      { clientId: 'partner-a', calls: 4 },
      { clientId: 'partner-b', calls: 7 },
    ]);
  });

  it('adds up the same however it is sliced', async () => {
    // The reason every breakdown comes off one query: a service total shown
    // beside its operation rows has to equal them.
    const total = (rows: Array<{ calls: number }>) =>
      rows.reduce((sum, row) => sum + row.calls, 0);

    expect(total(await storage.countsByPlugin(RANGE))).toBe(11);
    expect(total(await storage.countsByClient(RANGE))).toBe(11);
    expect(total(await storage.countsByPluginOperation(RANGE))).toBe(11);
  });

  it('reports nothing at all for a range with no calls', async () => {
    rangeRows = [];

    // Absence, not zeroes: a day, plugin or client with no calls is simply
    // not in the answer, so a later screen decides for itself whether to draw
    // a gap or a zero.
    expect(await storage.countsByPlugin(RANGE)).toEqual([]);
    expect(await storage.countsByClient(RANGE)).toEqual([]);
    expect(await storage.countsByPluginOperation(RANGE)).toEqual([]);
    expect(await storage.countsByDay(RANGE)).toEqual([]);
  });

  it('keeps counting a plugin the registry no longer knows about', async () => {
    rangeRows = [{ pluginId: 'retired-v0', clientId: 'partner-a', operation: 'gone', calls: 4 }];

    // These reads answer from the counts, never from the plugin registry: a
    // retired service's calls are exactly the ones somebody auditing usage
    // wants to account for.
    expect(await storage.countsByPlugin(RANGE)).toEqual([{ pluginId: 'retired-v0', calls: 4 }]);
  });
});

/**
 * One-off verification for StorageSessionStore + session lifecycle logging.
 * Exercises set/get/touch/destroy, expired filtering, per-session prune, and
 * asserts the storage log entries: created-once, silent re-save/touch, and
 * per-session deletion logs with reason.
 */
import { StorageSessionStore } from "../../server/auth/session-store";
import { storage } from "../../server/storage";
import { db } from "../../server/storage/db";
import { sql } from "drizzle-orm";
import type { SessionData } from "express-session";

function call<T>(fn: (cb: (err: unknown, res?: T) => void) => void): Promise<T | undefined> {
  return new Promise((resolve, reject) => fn((err, res) => (err ? reject(err) : resolve(res))));
}

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? " :: " + JSON.stringify(detail) : ""}`);
  if (!ok) failures++;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Storage-log descriptions for a sid (retries: log writes are deferred+async). */
async function logsFor(sid: string, expectAtLeast: number): Promise<string[]> {
  for (let i = 0; i < 20; i++) {
    const res = await db.execute(sql`
      SELECT description FROM winston_logs
      WHERE module = 'sessions' AND entity_id = ${sid}
      ORDER BY timestamp ASC
    `);
    const rows = (res.rows as any[]).map((r) => String(r.description));
    if (rows.length >= expectAtLeast) return rows;
    await sleep(250);
  }
  const res = await db.execute(sql`
    SELECT description FROM winston_logs WHERE module = 'sessions' AND entity_id = ${sid} ORDER BY timestamp ASC
  `);
  return (res.rows as any[]).map((r) => String(r.description));
}

async function main() {
  const store = new StorageSessionStore({ ttlMs: 60_000 });
  const sid = `verify-store-${Date.now()}`;
  const inOneHour = new Date(Date.now() + 3600_000);
  const fakeUserId = `verify-user-${Date.now()}`;
  const passport = { user: { dbUser: { id: fakeUserId }, claims: { sub: "should-not-win" } } };
  const sess = { cookie: { maxAge: 3600_000, expires: inOneHour.toISOString() }, marker: "hello", passport } as unknown as SessionData;

  /** host_entity_id values of session logs for a sid. */
  async function hostsFor(sid: string): Promise<Record<string, string | null>> {
    const res = await db.execute(sql`
      SELECT description, host_entity_id FROM winston_logs
      WHERE module = 'sessions' AND entity_id = ${sid} ORDER BY timestamp ASC
    `);
    return Object.fromEntries((res.rows as any[]).map((r) => [String(r.description), r.host_entity_id ?? null]));
  }

  // create
  await call<void>((cb) => store.set(sid, sess, cb));
  const got = await call<SessionData | null>((cb) => store.get(sid, cb));
  check("set + get round-trips", (got as any)?.marker === "hello");

  // upsert created-flag semantics
  const again = await storage.sessions.upsertSession(sid, { ...(sess as any), marker: "hello2" }, inOneHour);
  check("second upsert reports created=false", again.created === false);

  // touch
  const later = new Date(Date.now() + 7200_000);
  const sess2 = { ...(sess as any), cookie: { ...(sess as any).cookie, expires: later.toISOString() } } as SessionData;
  await call<void>((cb) => store.touch(sid, sess2, cb));
  const active = await storage.sessions.getSessions();
  const mine = active.find((s) => s.sid === sid);
  check("touch rolls expiry forward", !!mine && Math.abs(mine.expire.getTime() - later.getTime()) < 2000, { expire: mine?.expire });

  // logging: exactly one "Session created", nothing from re-save/touch
  const createLogs = await logsFor(sid, 1);
  check("exactly one 'Session created' log after set+resave+touch",
    createLogs.filter((d) => d.startsWith("Session created")).length === 1 && createLogs.length === 1,
    createLogs);

  // redaction: the persisted log entry must not contain the session payload
  const metaRes = await db.execute(sql`
    SELECT meta FROM winston_logs WHERE module = 'sessions' AND entity_id = ${sid}
  `);
  const metaStr = JSON.stringify((metaRes.rows as any[]).map((r) => r.meta));
  check("session payload redacted from log meta",
    !metaStr.includes("hello") && metaStr.includes("redacted"));

  // expired session invisible + per-session prune with reason
  // attribution: created entry lands on the session owner's account log
  const createdHosts = await hostsFor(sid);
  check("created log attributed to session owner (dbUser.id wins)",
    Object.values(createdHosts)[0] === fakeUserId, createdHosts);

  const sidExpired = `${sid}-expired`;
  await storage.sessions.upsertSession(sidExpired, { cookie: {}, passport }, new Date(Date.now() - 1000));
  const gotExpired = await call<SessionData | null>((cb) => store.get(sidExpired, cb));
  check("expired session not returned by get", gotExpired == null);

  const expiredSids = await storage.sessions.getExpiredSessionSids();
  check("expired sid listed for prune", expiredSids.includes(sidExpired));

  // regression: a session renewed AFTER the candidate scan must survive
  const sidRenewed = `${sid}-renewed`;
  await storage.sessions.upsertSession(sidRenewed, { cookie: {} }, new Date(Date.now() - 1000));
  const candidates = await storage.sessions.getExpiredSessionSids();
  check("renewed-candidate listed while expired", candidates.includes(sidRenewed));
  await storage.sessions.touchSession(sidRenewed, new Date(Date.now() + 3600_000)); // renewed between scan and delete
  for (const s of candidates) {
    await storage.sessions.deleteExpiredSession(s);
  }
  const renewedStill = await storage.sessions.getSessionData(sidRenewed);
  check("renewed session survives prune race", renewedStill !== undefined);
  await storage.sessions.deleteSession(sidRenewed); // cleanup

  const goneRow = await storage.sessions.getSessionData(sidExpired);
  check("expired row gone after prune", goneRow === undefined);
  const expiredLogs = await logsFor(sidExpired, 2);
  check("expired session has created + expired-delete logs",
    expiredLogs.some((d) => d.startsWith("Session created")) &&
    expiredLogs.some((d) => d.startsWith("Deleted session") && d.includes("(expired)")),
    expiredLogs);
  const expiredHosts = await hostsFor(sidExpired);
  check("expired-delete log attributed to session owner (cron path, no request context)",
    Object.entries(expiredHosts).every(([, h]) => h === fakeUserId), expiredHosts);

  // pre-auth (anonymous) session: no fabricated attribution
  const sidAnon = `${sid}-anon`;
  await storage.sessions.upsertSession(sidAnon, { cookie: {} }, new Date(Date.now() + 60_000));
  const anonLogs = await logsFor(sidAnon, 1);
  const anonHosts = await hostsFor(sidAnon);
  check("anonymous session created log stays unattributed",
    anonLogs.length === 1 && Object.values(anonHosts).every((h) => h == null), anonHosts);
  await storage.sessions.deleteSession(sidAnon); // cleanup

  // claims-only session (external provider subject, no resolved dbUser):
  // must NOT be attributed — claims.sub is not an internal account id
  const sidClaims = `${sid}-claims`;
  await storage.sessions.upsertSession(
    sidClaims,
    { cookie: {}, passport: { user: { claims: { sub: "external-subject-999" } } } },
    new Date(Date.now() + 60_000),
  );
  await storage.sessions.deleteSession(sidClaims, "logout");
  const claimsLogs = await logsFor(sidClaims, 2);
  const claimsHosts = await hostsFor(sidClaims);
  check("claims-only session logs stay unattributed (no claims.sub fallback)",
    claimsLogs.length === 2 && Object.values(claimsHosts).every((h) => h == null), claimsHosts);

  // destroy (logout) log
  await call<void>((cb) => store.destroy(sid, cb));
  const gone = await call<SessionData | null>((cb) => store.get(sid, cb));
  check("destroy removes session", gone == null);
  const finalLogs = await logsFor(sid, 2);
  check("logout delete logged with reason",
    finalLogs.some((d) => d.startsWith("Deleted session") && d.includes("(logout)")),
    finalLogs);
  const finalHosts = await hostsFor(sid);
  check("logout delete log attributed to session owner",
    Object.entries(finalHosts).filter(([d]) => d.startsWith("Deleted")).every(([, h]) => h === fakeUserId),
    finalHosts);

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

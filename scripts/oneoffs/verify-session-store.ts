/**
 * One-off verification for StorageSessionStore (task: route session writes
 * through the storage layer). Exercises set/get/touch/destroy plus expired
 * filtering and prune, directly against the dev database.
 */
import { StorageSessionStore } from "../../server/auth/session-store";
import { storage } from "../../server/storage";
import type { SessionData } from "express-session";

function call<T>(fn: (cb: (err: unknown, res?: T) => void) => void): Promise<T | undefined> {
  return new Promise((resolve, reject) => fn((err, res) => (err ? reject(err) : resolve(res))));
}

let failures = 0;
function check(name: string, ok: boolean, detail?: unknown) {
  console.log(`${ok ? "PASS" : "FAIL"} ${name}${detail !== undefined ? " :: " + JSON.stringify(detail) : ""}`);
  if (!ok) failures++;
}

async function main() {
  const store = new StorageSessionStore({ ttlMs: 60_000 });
  const sid = `verify-store-${Date.now()}`;
  const inOneHour = new Date(Date.now() + 3600_000);
  const sess = { cookie: { maxAge: 3600_000, expires: inOneHour.toISOString() }, marker: "hello" } as unknown as SessionData;

  await call<void>((cb) => store.set(sid, sess, cb));
  const got = await call<SessionData | null>((cb) => store.get(sid, cb));
  check("set + get round-trips", (got as any)?.marker === "hello");

  const rowAfterSet = await storage.sessions.getSessionData(sid);
  check("expire honors cookie.expires", rowAfterSet !== undefined);

  // touch with a later expiry
  const later = new Date(Date.now() + 7200_000);
  const sess2 = { ...(sess as any), cookie: { ...(sess as any).cookie, expires: later.toISOString() } } as SessionData;
  await call<void>((cb) => store.touch(sid, sess2, cb));
  const active = await storage.sessions.getSessions();
  const mine = active.find((s) => s.sid === sid);
  check("touch rolls expiry forward", !!mine && mine.expire.getTime() - later.getTime() < 2000 && mine.expire.getTime() >= later.getTime() - 2000, { expire: mine?.expire });

  // expired session is invisible to get
  const sidExpired = `${sid}-expired`;
  await storage.sessions.upsertSession(sidExpired, { cookie: {} }, new Date(Date.now() - 1000));
  const gotExpired = await call<SessionData | null>((cb) => store.get(sidExpired, cb));
  check("expired session not returned by get", gotExpired == null);

  const pruned = await storage.sessions.deleteExpiredSessions();
  check("prune removes expired rows", pruned >= 1, { pruned });
  const goneRow = await storage.sessions.getSessionData(sidExpired);
  check("expired row gone after prune", goneRow === undefined);

  await call<void>((cb) => store.destroy(sid, cb));
  const gone = await call<SessionData | null>((cb) => store.get(sid, cb));
  check("destroy removes session", gone == null);

  console.log(failures === 0 ? "ALL PASS" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => { console.error(e); process.exit(1); });

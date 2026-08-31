import type { Express } from "express";
import { z } from "zod";
import { storage } from "../../storage";
import { requireAccess } from "../../services/access-policy-evaluator";
import { listWcRequests, resolveWcDuration } from "../../services/webclient";
import type { WcCacheRow } from "../../storage/wc-cache";

/**
 * Admin visibility into the web client cache — the record of what we asked
 * third parties and what they told us.
 *
 * Two things about this screen are deliberate:
 *
 * - **Freshness is derived, never stored.** There is no expiry column: an
 *   entry is fresh when the window its (service, request type) declares in the
 *   behavior registry has not yet elapsed since `fetchedAt`, and that window is
 *   resolved on every request exactly as `wcRequest` resolves it. An operator
 *   who shortens a setting sees the change here at once, and this screen can
 *   never disagree with the wrapper about whether a stored answer would be
 *   served.
 * - **An unregistered entry is still a real entry.** A row whose request type
 *   no longer has a registered behavior (a retired lookup, an older release)
 *   has no window to judge against, so its freshness is reported as unknown —
 *   but it still lists, still opens, and can still be expired. Hiding it would
 *   leave the only rows nobody can explain in the one place nobody can reach.
 *
 * Responses are shown verbatim. This table holds whatever the vendor returned
 * and admin access to it is the intended level of exposure; the gate is the
 * protection, not redaction.
 */

const listQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  service: z.string().trim().min(1).optional(),
  requestType: z.string().trim().min(1).optional(),
  requestKey: z.string().trim().min(1).optional(),
});

/** What the list and detail views add on top of the stored row. */
interface WcCacheDecoration {
  /** False when no behavior is registered for this (service, request type). */
  registered: boolean;
  /** Inside its window. Null when there is no window to judge against. */
  fresh: boolean | null;
  /** The window applied, in milliseconds. Null when unregistered. */
  windowMs: number | null;
}

/**
 * The windows for every registered request type, resolved now.
 *
 * Resolved once per HTTP request rather than once per row: a window can be a
 * settings read, and a page of 25 rows of one request type must not become 25
 * of them.
 */
async function resolveWindows(): Promise<
  Map<string, { freshFor: number; failureRememberedFor: number }>
> {
  const windows = new Map<string, { freshFor: number; failureRememberedFor: number }>();
  for (const behavior of listWcRequests()) {
    windows.set(`${behavior.service}:${behavior.requestType}`, {
      freshFor: await resolveWcDuration(behavior.freshFor),
      failureRememberedFor: await resolveWcDuration(behavior.failureRememberedFor),
    });
  }
  return windows;
}

function decorate(
  row: Pick<WcCacheRow, "service" | "requestType" | "outcome" | "fetchedAt">,
  windows: Map<string, { freshFor: number; failureRememberedFor: number }>,
  now: number,
): WcCacheDecoration {
  const window = windows.get(`${row.service}:${row.requestType}`);
  if (!window) return { registered: false, fresh: null, windowMs: null };
  // A failure row is held for its own, much shorter window — the same one the
  // wrapper judges it against before deciding whether to attempt the call
  // again.
  const windowMs =
    row.outcome === "failure" ? window.failureRememberedFor : window.freshFor;
  return {
    registered: true,
    fresh: now - new Date(row.fetchedAt).getTime() < windowMs,
    windowMs,
  };
}

export function registerWcCacheAdminRoutes(app: Express) {
  // Every (service, request type) worth offering as a filter: the pairs
  // present in the table, plus the registered ones that have no rows yet.
  // A pair present but unregistered is included and marked, because it is the
  // one an operator is most likely to be looking for.
  //
  // Registered before `/:id` so the literal path is not read as an id.
  app.get("/api/admin/wc-cache/request-types", requireAccess("admin"), async (_req, res) => {
    try {
      const present = await storage.wcCache.listRequestTypes();
      const byKey = new Map<
        string,
        { service: string; requestType: string; rows: number; registered: boolean }
      >();
      for (const row of present) {
        byKey.set(`${row.service}:${row.requestType}`, { ...row, registered: false });
      }
      for (const behavior of listWcRequests()) {
        const key = `${behavior.service}:${behavior.requestType}`;
        const existing = byKey.get(key);
        byKey.set(key, {
          service: behavior.service,
          requestType: behavior.requestType,
          rows: existing?.rows ?? 0,
          registered: true,
        });
      }
      const result = Array.from(byKey.values()).sort(
        (a, b) =>
          a.service.localeCompare(b.service) || a.requestType.localeCompare(b.requestType),
      );
      res.json(result);
    } catch (error) {
      console.error("Failed to list web client cache request types:", error);
      res.status(500).json({ message: "Failed to list request types" });
    }
  });

  // One page of stored answers, newest first, without their response bodies.
  app.get("/api/admin/wc-cache", requireAccess("admin"), async (req, res) => {
    const parsed = listQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ message: "Invalid query parameters", errors: parsed.error.flatten() });
      return;
    }
    try {
      const { page, pageSize, service, requestType, requestKey } = parsed.data;
      const filters = { service, requestType, requestKey };
      const [rows, total, windows] = await Promise.all([
        storage.wcCache.list({ page, pageSize, ...filters }),
        storage.wcCache.count(filters),
        resolveWindows(),
      ]);
      const now = Date.now();
      res.json({
        rows: rows.map((row) => ({ ...row, ...decorate(row, windows, now) })),
        total,
      });
    } catch (error) {
      console.error("Failed to list web client cache entries:", error);
      res.status(500).json({ message: "Failed to list cache entries" });
    }
  });

  // One stored answer, response body included.
  app.get("/api/admin/wc-cache/:id", requireAccess("admin"), async (req, res) => {
    try {
      const row = await storage.wcCache.getById(req.params.id);
      if (!row) {
        res.status(404).json({ message: "Cache entry not found" });
        return;
      }
      const windows = await resolveWindows();
      res.json({ ...row, ...decorate(row, windows, Date.now()) });
    } catch (error) {
      console.error("Failed to fetch web client cache entry:", error);
      res.status(500).json({ message: "Failed to fetch cache entry" });
    }
  });

  // Force-expire one entry: the stored answer is forgotten, so the next
  // request for that key goes back to the vendor. This works the same whether
  // or not the request type is still registered — the row is the thing being
  // removed, and nothing about removing it needs to know its window.
  app.post("/api/admin/wc-cache/:id/expire", requireAccess("admin"), async (req, res) => {
    try {
      const deleted = await storage.wcCache.deleteById(req.params.id);
      if (!deleted) {
        res.status(404).json({ message: "Cache entry not found — nothing to expire" });
        return;
      }
      res.json({ expired: true });
    } catch (error) {
      console.error("Failed to expire web client cache entry:", error);
      res.status(500).json({ message: "Failed to expire cache entry" });
    }
  });
}

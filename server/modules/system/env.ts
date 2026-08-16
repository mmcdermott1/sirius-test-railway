import type { Express } from "express";
import { storage } from "../../storage";
import { requireAccess } from "../../services/access-policy-evaluator";
import {
  getEnvironmentVariable,
  isEnvironmentVariableOverridable,
  isEnvironmentVariableRegistered,
  isEnvironmentVariableSetInProcess,
  listEnvironmentVariables,
} from "../../config/env-registry";
import {
  ENV_OVERRIDES_VARIABLE,
  getEnvOverrideMap,
} from "../../services/env-overrides";
import { validateVariableValue, runVariableOnWrite } from "./variable-registry";

/**
 * Admin endpoints for the /config/env page (Task #1080).
 *
 * - GET  /api/admin/env            — all registered variables with status,
 *   source (environment | override | unset), and values (secret values are
 *   NEVER returned, regardless of source).
 * - PUT  /api/admin/env/:name      — set a DB override for a variable that
 *   is not set in the real environment.
 * - DELETE /api/admin/env/:name    — clear a DB override.
 *
 * Writes go through the same storage + registry path as the generic
 * variable routes (schema validation, audit logging, onWrite cache refresh).
 */
export function registerEnvRoutes(app: Express) {
  app.get("/api/admin/env", requireAccess("admin"), async (_req, res) => {
    try {
      const overrides = getEnvOverrideMap();
      const vars = listEnvironmentVariables().map((v) => {
        let value: string | null = null;
        if (!v.secret && v.isSet) {
          try {
            value = getEnvironmentVariable(v.name) ?? null;
          } catch {
            value = null;
          }
        }
        return {
          ...v,
          // Never the value for secrets; effective value otherwise.
          value,
          // A stale override shadowed by a real env value — surfaced so the
          // admin understands why editing is locked despite the override.
          hasShadowedOverride: v.source === "environment" && overrides.has(v.name),
        };
      });
      res.setHeader("Cache-Control", "no-store");
      res.json(vars);
    } catch (error) {
      res.status(500).json({ message: "Failed to list environment variables" });
    }
  });

  // Serialize override read-modify-writes within this instance so two
  // concurrent admin edits can't lose each other's change. The map is always
  // re-read fresh from the DB inside the critical section (never the cache).
  let writeChain: Promise<unknown> = Promise.resolve();
  const withWriteLock = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = writeChain.then(fn, fn);
    writeChain = run.catch(() => {});
    return run;
  };

  const readCurrentOverrides = async (): Promise<Record<string, string>> => {
    const row = await storage.variables.getByName(ENV_OVERRIDES_VARIABLE);
    const out: Record<string, string> = {};
    const value = row?.value;
    if (value && typeof value === "object" && !Array.isArray(value)) {
      for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
        if (typeof v === "string") out[k] = v;
      }
    }
    return out;
  };

  const writeOverrides = async (next: Record<string, string>): Promise<void> => {
    const validation = validateVariableValue(ENV_OVERRIDES_VARIABLE, next);
    if (!validation.ok) {
      const messages = validation.errors.map((e) => e.message).join("; ");
      throw Object.assign(new Error(messages || "Invalid override map"), { status: 400 });
    }
    const existing = await storage.variables.getByName(ENV_OVERRIDES_VARIABLE);
    if (existing) {
      await storage.variables.update(existing.id, { value: validation.value });
    } else {
      await storage.variables.create({
        name: ENV_OVERRIDES_VARIABLE,
        value: validation.value,
      });
    }
    await runVariableOnWrite(ENV_OVERRIDES_VARIABLE);
  };

  app.put("/api/admin/env/:name", requireAccess("admin"), async (req, res) => {
    try {
      const { name } = req.params;
      if (!isEnvironmentVariableRegistered(name)) {
        res.status(404).json({ message: "Unknown environment variable" });
        return;
      }
      if (!isEnvironmentVariableOverridable(name)) {
        res.status(400).json({ message: "This variable cannot be overridden" });
        return;
      }
      if (isEnvironmentVariableSetInProcess(name)) {
        res.status(409).json({
          message: "This variable is set in the real environment and is locked",
        });
        return;
      }
      const value = (req.body ?? {}).value;
      if (typeof value !== "string" || value === "") {
        res.status(400).json({ message: "Request body must include a non-empty string value" });
        return;
      }
      await withWriteLock(async () => {
        const next = await readCurrentOverrides();
        next[name] = value;
        await writeOverrides(next);
      });
      res.json({ ok: true });
    } catch (error: any) {
      res
        .status(error?.status ?? 500)
        .json({ message: error?.message || "Failed to set override" });
    }
  });

  app.delete("/api/admin/env/:name", requireAccess("admin"), async (req, res) => {
    try {
      const { name } = req.params;
      const found = await withWriteLock(async () => {
        const next = await readCurrentOverrides();
        if (!(name in next)) return false;
        delete next[name];
        await writeOverrides(next);
        return true;
      });
      if (!found) {
        res.status(404).json({ message: "No override set for this variable" });
        return;
      }
      res.json({ ok: true });
    } catch (error: any) {
      res
        .status(error?.status ?? 500)
        .json({ message: error?.message || "Failed to clear override" });
    }
  });
}

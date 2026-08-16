import { storage } from "../storage";
import { logger } from "../logger";
import { setEnvironmentVariableOverrideSource } from "../config/env-registry";

/**
 * DB-backed environment-variable overrides (Task #1080).
 *
 * A single `variables` row named `env_overrides` holds a JSON map of
 * { VARIABLE_NAME: "value" }. This module loads it into an in-memory cache
 * and installs a synchronous lookup into the env registry so that
 * `getEnvironmentVariable` can fall back to the override when the variable
 * is absent from the real process environment (a real env value always
 * wins — the deployment pipeline "locks" the variable).
 *
 * The cache is refreshed after every committed write to the row (via the
 * variable registry's onWrite hook), so overrides take effect for
 * subsequent reads without a restart. Consumers that read env only at boot
 * (e.g. the SAML strategy) still need an app restart to pick up changes.
 */

export const ENV_OVERRIDES_VARIABLE = "env_overrides";

let cache = new Map<string, string>();

function parseOverrides(value: unknown): Map<string, string> {
  const next = new Map<string, string>();
  if (value && typeof value === "object" && !Array.isArray(value)) {
    for (const [name, v] of Object.entries(value as Record<string, unknown>)) {
      if (typeof v === "string") next.set(name, v);
    }
  }
  return next;
}

/** Reload the cache from the variables table. */
export async function refreshEnvOverrides(): Promise<void> {
  const row = await storage.variables.getByName(ENV_OVERRIDES_VARIABLE);
  cache = parseOverrides(row?.value);
}

/** Current override map (names → values). For the admin endpoints only. */
export function getEnvOverrideMap(): ReadonlyMap<string, string> {
  return cache;
}

/**
 * Load the overrides and install the sync lookup into the env registry.
 * Call once from bootstrapApp, after migrations (needs the variables table).
 */
export async function initEnvOverrides(): Promise<void> {
  await refreshEnvOverrides();
  setEnvironmentVariableOverrideSource((name) => cache.get(name));
  logger.info("Environment-variable overrides initialized", {
    source: "startup",
    count: cache.size,
  });
}

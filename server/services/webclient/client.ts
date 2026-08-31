import { assertExternalServiceAllowed, isMaintenanceModeError } from "../maintenance-flag";
import { logger } from "../../logger";
import { wcCacheStorage, wcRequestKeyHash, type WcCacheEntry } from "../../storage/wc-cache";
import { getWcRequest, resolveWcDuration } from "./registry";
import type { WcAnswer, WcRequestBehavior, WcRequestMode, WcResult, WcService } from "./types";

export interface WcRequestOptions<TValue> {
  service: WcService;
  requestType: string;
  /** Whatever the registered canonicalizer expects. */
  args: unknown;
  mode?: WcRequestMode;
  /**
   * Make the call. Invoked only when the wrapper has decided the vendor
   * should be asked, and must declare whether the vendor answered.
   */
  fetch: () => Promise<WcAnswer<TValue>>;
}

/**
 * Answers we paid for and could not keep.
 *
 * The hold that stops a request being retried lives in the cache table, so it
 * survives a restart and is shared across processes. That mechanism is exactly
 * unavailable in the one case this map covers: the writable-database gate
 * passed, the vendor was asked and answered, and the write then failed because
 * the connection turned read-only mid-call. The money is already spent and
 * nothing can be written — including a hold — so the only place left to
 * remember it is here. Short-lived by construction.
 */
const unstorableHolds = new Map<string, number>();

function holdKey(behavior: WcRequestBehavior, requestKey: string): string {
  return `${behavior.service}:${behavior.requestType}:${wcRequestKeyHash(requestKey)}`;
}

function inUnstorableHold(behavior: WcRequestBehavior, requestKey: string): boolean {
  const key = holdKey(behavior, requestKey);
  const until = unstorableHolds.get(key);
  if (until === undefined) return false;
  if (until > Date.now()) return true;
  unstorableHolds.delete(key);
  return false;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function storedError(response: unknown): string | undefined {
  if (!response || typeof response !== "object") return undefined;
  const value = (response as { error?: unknown }).error;
  return typeof value === "string" ? value : undefined;
}

/**
 * The single entry point for an outbound third-party request.
 *
 * Resolves an answer from the cache or by making the call, according to the
 * behavior registered for (service, request type). Everything about the
 * decision — how long an answer stays fresh, how long a failure is remembered,
 * what makes two requests the same — comes from the registry and is read now,
 * so a changed policy takes effect on the next request rather than only on
 * entries written afterwards.
 *
 * Throws `MaintenanceModeError` when the call it was about to make is refused;
 * a request served from the cache is not a call and is not refused.
 */
export async function wcRequest<TValue>(
  options: WcRequestOptions<TValue>,
): Promise<WcResult<TValue>> {
  const behavior = getWcRequest(options.service, options.requestType);
  if (!behavior) {
    throw new Error(
      `No web client behavior registered for "${options.service}:${options.requestType}". ` +
        `Register one before making the request — an unregistered request has no ` +
        `canonical key and no idea what to keep.`,
    );
  }

  const mode: WcRequestMode = options.mode ?? "default";

  // Fully local: neither the cache nor the network is read. Callers on this
  // path are passing through to have an argument normalized, not to ask the
  // question, and there are enough of them that a query here would be felt.
  if (mode === "local") return { source: "none", fresh: false };

  const requestKey = behavior.requestKey(options.args);
  const now = Date.now();

  let entry: WcCacheEntry | undefined;
  if (behavior.cached) {
    try {
      entry = await wcCacheStorage.read(behavior.service, behavior.requestType, requestKey);
    } catch (error) {
      logger.error("Failed to read the web client cache", {
        service: "webclient",
        vendor: behavior.service,
        requestType: behavior.requestType,
        error: errorMessage(error),
      });
    }
  }

  const freshFor = await resolveWcDuration(behavior.freshFor);
  const failureRememberedFor = await resolveWcDuration(behavior.failureRememberedFor);
  const window = entry?.outcome === "failure" ? failureRememberedFor : freshFor;
  const fresh = entry ? now - entry.fetchedAt.getTime() < window : false;

  const stored = (): WcResult<TValue> => {
    if (!entry) return { source: "none", fresh: false };
    return {
      source: "cache",
      outcome: entry.outcome,
      fresh,
      value: entry.outcome === "success" ? (entry.response as TValue) : undefined,
      fetchedAt: entry.fetchedAt,
      error: entry.outcome === "failure" ? storedError(entry.response) : undefined,
    };
  };

  if (mode === "cached-only") return stored();

  // A fresh entry answers the question. A fresh FAILURE answers it too: it is
  // the hold that stops an outage turning every read into another attempt.
  if (mode === "default" && entry && fresh) return stored();

  // Every request the wrapper is about to make is refused during maintenance,
  // in the shared guard's own words.
  assertExternalServiceAllowed(behavior.service, behavior.operation);

  if (inUnstorableHold(behavior, requestKey)) return stored();

  const needsWritable = behavior.needsWritableDatabase ?? behavior.cached;
  if (needsWritable && !(await wcCacheStorage.canStore())) {
    // Refused, not degraded: an answer that cannot be stored would be bought
    // again on the very next call.
    return stored();
  }

  let answer: WcAnswer<TValue>;
  try {
    answer = await options.fetch();
  } catch (error) {
    // A refusal is not a vendor failure and must not become a hold.
    if (isMaintenanceModeError(error)) throw error;
    answer = { answered: false, error: errorMessage(error) };
  }

  if (answer.answered) {
    const fetchedAt = new Date();
    if (behavior.cached && (answer.store ?? true)) {
      try {
        await wcCacheStorage.writeSuccess(
          behavior.service,
          behavior.requestType,
          requestKey,
          answer.value ?? null,
        );
      } catch (error) {
        logger.error("Paid for a web client answer that could not be stored", {
          service: "webclient",
          vendor: behavior.service,
          requestType: behavior.requestType,
          error: errorMessage(error),
        });
        unstorableHolds.set(holdKey(behavior, requestKey), Date.now() + failureRememberedFor);
      }
    }
    return {
      source: "network",
      outcome: "success",
      fresh: true,
      value: answer.value,
      fetchedAt,
    };
  }

  if (behavior.cached) {
    try {
      await wcCacheStorage.writeFailure(
        behavior.service,
        behavior.requestType,
        requestKey,
        answer.error,
        new Date(now - freshFor),
      );
    } catch (error) {
      logger.error("Failed to record a web client failure", {
        service: "webclient",
        vendor: behavior.service,
        requestType: behavior.requestType,
        error: errorMessage(error),
      });
    }
  }

  // A stored answer, even one the failure just displaced, beats nothing: the
  // caller asked a question we have answered before.
  if (entry?.outcome === "success") {
    return { ...stored(), fallback: answer.value, error: answer.error };
  }

  return {
    source: "network",
    outcome: "failure",
    fresh: false,
    fallback: answer.value,
    error: answer.error,
  };
}

/** Test seam: forget the in-memory unstorable holds. */
export function resetUnstorableHolds(): void {
  unstorableHolds.clear();
}

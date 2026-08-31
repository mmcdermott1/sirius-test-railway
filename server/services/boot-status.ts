/**
 * Boot-status registry.
 *
 * A tiny, dependency-free module that boot-time services write into and the
 * boot-status HTTP surface (`server/services/boot-status-http.ts`) reads
 * from. It MUST stay free of imports (no logger, no db, no shared/schema) so
 * the entry points can import it before DATABASE_URL is assembled and
 * regardless of whether app-init ever loaded successfully.
 */

export type DriftCheckStatus = "not-run" | "passed" | "skipped" | "failed";

/**
 * Which state this process's boot is actually in.
 *
 * The distinction is the whole point: "starting" is a state that will change
 * on its own, while "init-failed" and "report-only" never will. Telling an
 * operator to wait for one of the latter two is a lie, and it is the lie
 * that left a wedged deployment undiagnosed.
 *
 *   - "starting"    — bootstrap is still running; retrying may succeed.
 *   - "ready"       — bootstrap finished; the application serves traffic.
 *   - "init-failed" — bootstrap threw. Permanent for this process.
 *   - "report-only" — BRINGUP_REPORT_ONLY=1 stopped the boot on purpose.
 *                     Not a failure; the report is the deliverable.
 */
export type BootPhase = "starting" | "ready" | "init-failed" | "report-only";

/**
 * What stopped the boot, for the health endpoint.
 *
 * A deployment blocked on migrations or drift is a different operational
 * situation from an ordinary startup failure: it means the image is fine and
 * the DATABASE is the problem, which is what the operator has to know before
 * they can decide between redeploying, setting a recovery variable, or
 * shipping a baseline.
 */
export type BootBlockedOn =
  | "none"
  | "database"
  | "migrations"
  | "drift"
  | "report-only"
  | "other";

export const bootStatus: {
  driftCheck: DriftCheckStatus;
  blockedOn: BootBlockedOn;
  phase: BootPhase;
  /**
   * The error that ended the boot, in BOTH the failed and the report-only
   * phase (report-only stops by throwing a named error). Held so the HTTP
   * surface can expose its message/stack under EXPOSE_BOOT_ERRORS.
   */
  initError: Error | null;
} = {
  driftCheck: "not-run",
  blockedOn: "none",
  phase: "starting",
  initError: null,
};

/** Bootstrap finished; the application is serving. */
export function markBootReady(): void {
  bootStatus.phase = "ready";
}

/**
 * Bootstrap threw. Permanent for this process: the entry points deliberately
 * keep serving instead of exiting, so the failure stays observable over HTTP
 * rather than crash-looping the container.
 */
export function markBootFailed(error: Error): void {
  bootStatus.phase = "init-failed";
  bootStatus.initError = error;
}

/**
 * BRINGUP_REPORT_ONLY=1 stopped the boot after producing the report. The
 * process did exactly what it was told; nothing was written and nothing will
 * change without a redeploy that drops the variable.
 */
export function markBootReportOnly(error: Error): void {
  bootStatus.phase = "report-only";
  bootStatus.initError = error;
}

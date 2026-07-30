import type { BasePluginMetadata } from "../../_core/types";

/**
 * Message priority levels, ordered from least to most severe. The admin
 * status page badges each message; the dashboard widget rolls up warnings
 * and errors.
 */
export const STATUS_PRIORITIES = ["info", "notice", "warning", "error"] as const;
export type StatusPriority = (typeof STATUS_PRIORITIES)[number];

/** One message produced by a status plugin's scan. */
export interface StatusMessage {
  priority: StatusPriority;
  title: string;
  details?: string;
}

/**
 * A system-status plugin. Each plugin scans one aspect of system health and
 * returns one or more messages. Scans are run by the collector (see
 * `collector.ts`) inside a timeout sandbox — a thrown or hung `scan()`
 * becomes an error-level message, never a failed page.
 *
 * Results live in shared memory only (wiped on restart); there is NO
 * database persistence for scan history by design.
 */
export interface SystemStatusPlugin extends BasePluginMetadata {
  /**
   * Whether the plugin supports on-demand re-scanning. Defaults to true.
   * Plugins whose result cannot meaningfully change between scans (e.g.
   * uptime/boot time) set this to false; the collector still scans them
   * once on first demand but the UI hides the rescan button and the
   * rescan endpoints refuse to re-run them.
   */
  canRescan?: boolean;
  /**
   * Per-plugin scan timeout in milliseconds. Defaults to
   * {@link DEFAULT_SCAN_TIMEOUT_MS}. When exceeded, the collector records
   * an error-level "scan timed out" message for the plugin.
   */
  timeoutMs?: number;
  /** Run the scan. Must not mutate any persistent state. */
  scan(): Promise<StatusMessage[]>;
}

/** Manifest entry shape for system-status plugins. */
export interface SystemStatusManifestEntry extends BasePluginMetadata {
  canRescan: boolean;
}

/** In-memory scan result for one plugin. */
export interface StatusScanResult {
  pluginId: string;
  messages: StatusMessage[];
  /** ISO timestamp of when the scan completed. */
  scannedAt: string;
  /** Wall-clock duration of the scan in milliseconds. */
  durationMs: number;
}

/**
 * One entry in the collector's response: plugin metadata joined with its
 * latest in-memory scan result. `result` is always present — the collector
 * scans on first demand.
 */
export interface SystemStatusEntry {
  id: string;
  name: string;
  description: string;
  canRescan: boolean;
  /** Highest-severity priority among the plugin's messages. */
  worstPriority: StatusPriority;
  result: StatusScanResult;
}

export const DEFAULT_SCAN_TIMEOUT_MS = 10_000;

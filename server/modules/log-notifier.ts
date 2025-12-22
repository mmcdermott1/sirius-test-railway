import { eventBus, EventType, type LogPayload } from "../services/event-bus";
import { logger } from "../logger";

const IGNORED_SOURCES = new Set([
  "log-notifier",
  "alert-dispatcher",
  "inapp-sender",
]);

async function handleLogEvent(payload: LogPayload): Promise<void> {
  if (payload.source && IGNORED_SOURCES.has(payload.source)) {
    return;
  }
  
  logger.debug("LOG event received", {
    source: "log-notifier",
    logId: payload.id,
    module: payload.module,
    operation: payload.operation,
  });
}

export function initLogNotifier(): void {
  eventBus.on(EventType.LOG, handleLogEvent);
  logger.info("Log notifier initialized", { source: "log-notifier" });
}

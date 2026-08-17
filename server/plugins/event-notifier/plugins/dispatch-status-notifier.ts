import {
  EventType,
  type DispatchStatusSavedPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import { templatesSchemaBlock } from "../template-schema";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotifierChannelTemplates,
  type NotifierRecipient,
} from "../types";

function payloadOf(ctx: EventNotifierEventContext): DispatchStatusSavedPayload {
  return ctx.payload as DispatchStatusSavedPayload;
}

const PLUGIN_ID = "dispatch-status-notifier";

/** Display label for a dispatch status value ("available" → "Available"),
 * merged onto the event entity as `status_label` so the default wording
 * matches the pre-token notifier. Raw `status` stays available. */
export function dispatchStatusLabel(status: string): string {
  switch (status) {
    case "available":
      return "Available";
    case "not_available":
      return "Not Available";
    default:
      return status;
  }
}

/**
 * Default per-channel templates. `dispatch` is a snapshot of the
 * worker's dispatch-status row built from the event payload (the live row
 * may have changed again by delivery time, and the row is gone entirely
 * for deletes).
 */
const TITLE = "Dispatch Status Changed";
const SENTENCE =
  'Your dispatch status is now {{dispatch.field(name="status_label")}}.';
// worker_id straight off the event snapshot — a relation lookup could
// come up empty and break the link even though the payload has the id.
const LINK_PATH =
  '/workers/{{dispatch.field(name="worker_id")}}/dispatch/status';
const LINK_LABEL = "View Dispatch";

function defaultTemplates(): NotifierChannelTemplates {
  return {
    email: {
      subject: TITLE,
      bodyHtml:
        `<p>${SENTENCE}<br><br>` +
        `View your dispatch page: ` +
        `<a href="{{system.base_url}}${LINK_PATH}">` +
        `{{system.base_url}}${LINK_PATH}</a></p>`,
    },
    sms: {
      message: `${SENTENCE} View: {{system.base_url}}${LINK_PATH}`,
    },
    inapp: {
      title: TITLE,
      body: SENTENCE,
      linkUrl: LINK_PATH,
      linkLabel: LINK_LABEL,
    },
  };
}

/**
 * Notifies a worker when their dispatch availability actually changes value —
 * whether the change was made by staff, by the worker, or automatically (e.g.
 * the Auto Sign-In denorm plugin or the primary-dispatch sign-out plugin).
 *
 * `shouldDispatch` skips deletes and saves that did not change the status
 * (the storage layer now carries `previousStatus` on the event for exactly
 * this comparison). `notifySelf: true` because automatic status changes run
 * in the context of whichever user triggered the dispatch action — often the
 * worker themself — and self-suppression would silently swallow those.
 */
export const dispatchStatusNotifier: EventNotifierPlugin = {
  id: "dispatch-status-notifier",
  name: "Dispatch Status Change Notifier",
  description:
    "Notifies the worker when their dispatch availability changes (Available / Not Available), including automatic changes such as auto sign-in.",
  order: 100,
  requiredComponent: "dispatch",
  notifySelf: true,
  subscribedEvents: [EventType.DISPATCH_STATUS_SAVED],
  supportedMedia: ["inapp", "email", "sms"],
  configSchema: {
    type: "object",
    properties: {
      templates: templatesSchemaBlock(PLUGIN_ID, {
        exampleTokens: [
          '{{dispatch.field(name="status")}}',
          '{{dispatch.worker.contact.field(name="display_name")}}',
        ],
      }),
    },
  },

  tokenTemplates: {
    roots: [
      {
        name: "dispatch",
        kind: "dispatch_worker_status",
        label: "Dispatch status",
        description: "The worker's dispatch availability row this event changed",
        // Derived value merged onto the row below — declared so
        // {{dispatch.field(name="status_label")}} is a real token.
        fields: ["status_label"],
        async build(ctx) {
          const { statusId, workerId, status } = payloadOf(ctx);
          if (!workerId || !status) return null;
          const { workerDispatchStatus } = await import(
            "../../../../shared/schema/dispatch/schema"
          );
          // Snapshot from the payload: renders the transition the event
          // describes even if the live row changed again (or was deleted).
          return {
            kind: "dispatch_worker_status",
            row: {
              id: statusId,
              workerId,
              status,
              statusLabel: dispatchStatusLabel(status),
            },
            table: workerDispatchStatus,
          };
        },
      },
    ],
    defaultTemplates,
  },

  shouldDispatch(ctx): boolean {
    const { status, previousStatus, isDeleted } = payloadOf(ctx);
    if (isDeleted) return false;
    // Only notify on a real transition. previousStatus is null on create
    // (no prior row → the worker "arrives" at a status) and undefined only
    // for legacy emits that predate the field — skip those to be safe.
    if (previousStatus === undefined) return false;
    return previousStatus !== status;
  },

  async getRecipients(ctx): Promise<NotifierRecipient[]> {
    const { workerId } = payloadOf(ctx);
    if (!workerId) return [];
    const { storage } = await import("../../../storage");
    const worker = await storage.workers.getWorker(workerId);
    const contactId = worker?.contactId;
    if (!contactId) return [];
    return [{ contactId }];
  },
};

registerEventNotifier(dispatchStatusNotifier);

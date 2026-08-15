import {
  EventType,
  type DispatchForeSavedPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import { templatesSchemaBlock } from "../template-schema";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotifierChannelTemplates,
  type NotifierRecipient,
} from "../types";

function payloadOf(ctx: EventNotifierEventContext): DispatchForeSavedPayload {
  return ctx.payload as DispatchForeSavedPayload;
}

const PLUGIN_ID = "dispatch-fore-notifier";

/**
 * Default per-channel templates. The event entity is the fore-membership
 * row (reconstructed from the payload for removals, whose row is gone by
 * delivery time) with the event's `action` (added/removed) merged on, so
 * one sentence stays grammatical for both. `action_label` carries the
 * capitalized form so the title matches the pre-token wording ("Added as
 * Foreperson" / "Removed as Foreperson").
 */
const TITLE = '{{event.field(name="action_label")}} as Foreperson';
const SENTENCE =
  'You have been {{event.field(name="action")}} as a Foreperson ' +
  'on "{{event.field(name="job_title")}}" ' +
  'at {{event.field(name="employer_name")}}.';
const LINK_PATH = '/dispatch/job/{{event.field(name="job_id")}}';
const LINK_LABEL = "View Job";

function defaultTemplates(): NotifierChannelTemplates {
  return {
    email: {
      subject: TITLE,
      bodyHtml:
        `<p>${SENTENCE}<br><br>` +
        `View the job: ` +
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
 * Notifies a worker when they are added to or removed from a dispatch job's
 * Forepersons. `notifySelf: true` because the change is always made by staff
 * acting on the worker's behalf — if a staff member happens to also be the
 * worker, self-suppression would silently swallow the notification.
 */
export const dispatchForeNotifier: EventNotifierPlugin = {
  id: "dispatch-fore-notifier",
  name: "Dispatch Foreperson Notifier",
  description:
    "Notifies the worker when they are added to or removed from a dispatch job's Forepersons.",
  order: 100,
  requiredComponent: "dispatch.fore",
  notifySelf: true,
  subscribedEvents: [EventType.DISPATCH_FORE_SAVED],
  supportedMedia: ["inapp", "email", "sms"],
  configSchema: {
    type: "object",
    properties: {
      templates: templatesSchemaBlock(PLUGIN_ID, {
        exampleTokens: [
          '{{event.field(name="action")}}',
          '{{event.dispatch_job.field(name="title")}}',
        ],
      }),
    },
  },

  tokenTemplates: {
    eventEntityKind: "dispatch_fore",
    async buildEventEntity(ctx) {
      const { foreId, jobId, workerId, action, jobTitle, employerName } =
        payloadOf(ctx);
      if (!jobId || !workerId) return null;
      const { dispatchJobFore } = await import(
        "../../../../shared/schema/dispatch/fore-schema"
      );
      // Snapshot from the payload: for removals the row is gone by
      // delivery time, and even for adds the payload describes exactly
      // the membership change this event is about. `job_title` and
      // `employer_name` ride on the payload too, so a renamed or deleted
      // job can't change (or blank) the message before delivery.
      return {
        kind: "dispatch_fore",
        row: {
          id: foreId,
          jobId,
          workerId,
          action,
          actionLabel: action === "added" ? "Added" : "Removed",
          jobTitle,
          employerName,
        },
        table: dispatchJobFore,
      };
    },
    defaultTemplates,
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

registerEventNotifier(dispatchForeNotifier);

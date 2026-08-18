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
 * Default per-channel templates. `dispatch_fore` is the fore-membership
 * row as the event carried it (a removal's row is gone by delivery time)
 * with the event's `action` (added/removed) merged on, so
 * one sentence stays grammatical for both. `action_label` carries the
 * capitalized form so the title matches the pre-token wording ("Added as
 * Foreperson" / "Removed as Foreperson"). The job is its own root, so its
 * title and employer are read off the job instead of being copied onto
 * the membership; `employer_id` is a foreign key and renders the
 * employer's name.
 */
const TITLE = '{{dispatch_fore.field(name="action_label")}} as Foreperson';
const SENTENCE =
  'You have been {{dispatch_fore.field(name="action")}} as a Foreperson ' +
  'on "{{dispatch_job.field(name="title")}}" ' +
  'at {{dispatch_job.field(name="employer_id")}}.';
const LINK_PATH = '/dispatch/job/{{dispatch_job.field(name="id")}}';
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
          '{{dispatch_fore.field(name="action")}}',
          '{{dispatch_job.field(name="start_ymd")}}',
        ],
      }),
    },
  },

  tokenTemplates: {
    roots: [
      {
        name: "dispatch_fore",
        kind: "dispatch_fore",
        label: "Foreperson membership",
        description:
          "The job-foreperson membership this event added or removed",
        async build(ctx) {
          const { fore, action } = payloadOf(ctx);
          if (!fore) return null;
          const { dispatchJobFore } = await import(
            "../../../../shared/schema/dispatch/fore-schema"
          );
          // The membership row as the event carried it, not a reload: a
          // removal's row is already gone by delivery time, and skipping
          // those would drop the very notice the worker needs. The event's
          // action rides alongside — no column records it.
          return {
            kind: "dispatch_fore",
            row: {
              ...(fore as unknown as Record<string, unknown>),
              action,
              actionLabel: action === "added" ? "Added" : "Removed",
            },
            table: dispatchJobFore,
          };
        },
      },
      {
        name: "dispatch_job",
        kind: "dispatch_job",
        label: "Dispatch job",
        description: "The dispatch job this foreperson change is on",
        // A job record, gated on the component that owns jobs — the same
        // gate any other surface offering a `dispatch_job` root uses.
        requiredComponent: "dispatch",
        async build(ctx) {
          const { job } = payloadOf(ctx);
          if (!job) return null;
          const { dispatchJobs } = await import(
            "../../../../shared/schema/dispatch/schema"
          );
          // The job row as of the event, carried on the payload. Reloading
          // it here would let a rename land in a message about an earlier
          // moment, and a job deleted right after the removal would abort a
          // notice the worker had already earned.
          return {
            kind: "dispatch_job",
            row: job as unknown as Record<string, unknown>,
            table: dispatchJobs,
          };
        },
      },
    ],
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

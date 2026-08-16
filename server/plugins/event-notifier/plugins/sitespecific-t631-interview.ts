import {
  EventType,
  type SitespecificT631InterviewSavedPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import { resolveStaffRecipients } from "../dispatcher";
import {
  EMPLOYER_VISIBLE_STATUSES,
  type InterviewStatus,
} from "../../../modules/sitespecific/t631/interview-rules";
import { T631_INTERVIEW_ENTITY_KIND } from "../../tokens/plugins/sitespecific-t631-interview";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotifierChannelTemplates,
  type NotifierRecipient,
} from "../types";

const PLUGIN_ID = "sitespecific_t631_interview";

const STATUS_VALUES = ["offered", "accepted", "declined", "passed", "failed"] as const;

function payloadOf(ctx: EventNotifierEventContext): SitespecificT631InterviewSavedPayload {
  return ctx.payload as SitespecificT631InterviewSavedPayload;
}

/** Human label for an interview status value ("offered" → "Offered"). */
function statusLabel(status: string): string {
  if (!status) return status;
  return status.charAt(0).toUpperCase() + status.slice(1);
}

interface InterviewNotifierConfig {
  targetStatus: string;
  recipientKind: "worker" | "employer" | "staff";
  staffRecipientUserIds: string[];
}

/** Read + normalize the admin's per-config settings off `data`. */
function configOf(configData: unknown): InterviewNotifierConfig {
  const data =
    configData && typeof configData === "object"
      ? (configData as Record<string, unknown>)
      : {};
  const kind = data.recipientKind;
  return {
    targetStatus: typeof data.targetStatus === "string" ? data.targetStatus : "",
    recipientKind:
      kind === "worker" || kind === "employer" || kind === "staff" ? kind : "worker",
    staffRecipientUserIds: Array.isArray(data.staffRecipientUserIds)
      ? (data.staffRecipientUserIds as unknown[]).filter(
          (v): v is string => typeof v === "string",
        )
      : [],
  };
}

/**
 * The page a recipient is linked to, as a token template. Workers land
 * on their own interviews tab; employer contacts and staff land on the
 * job's interviews page. `{{system.base_url}}` makes email/SMS links
 * absolute and leaves in-app links relative.
 */
function linkPathTemplate(recipientKind: InterviewNotifierConfig["recipientKind"]): {
  path: string;
  label: string;
} {
  if (recipientKind === "worker") {
    return {
      path: '/workers/{{event.worker.field(name="id")}}/dispatch/sitespecific_t631_interviews',
      label: "View Interview",
    };
  }
  return {
    path: '/dispatch/job/{{event.dispatch_job.field(name="id")}}/sitespecific_t631_interviews',
    label: "View Interviews",
  };
}

const SENTENCE =
  'The interview for {{event.worker.contact.field(name="display_name")}} ' +
  'on the job "{{event.dispatch_job.field(name="title")}}" ' +
  'is now {{event.field(name="status")}}.';

const TITLE = 'Interview {{event.field(name="status")}}';

/** Default per-channel templates; the link target varies with the recipient kind. */
function defaultTemplates(configData?: unknown): NotifierChannelTemplates {
  const { path, label } = linkPathTemplate(configOf(configData).recipientKind);
  return {
    email: {
      subject: TITLE,
      bodyHtml:
        `<p>${SENTENCE}</p>` +
        `<p><a href="{{system.base_url}}${path}">${label}</a></p>`,
    },
    sms: {
      message: `${SENTENCE} View: {{system.base_url}}${path}`,
    },
    inapp: {
      title: TITLE,
      body: SENTENCE,
      linkUrl: path,
      linkLabel: label,
    },
  };
}

/** Schema for one token-template field, wired to the token-template widget. */
function templateField(
  title: string,
  defaultPath: string,
  mode: "line" | "multiline" | "html" = "line",
): Record<string, unknown> {
  return {
    type: "string",
    title,
    "x-widget": "token-template",
    "x-token-template-mode": mode,
    "x-token-catalog-url": `/api/event-notifier/token-catalog/${PLUGIN_ID}`,
    "x-token-default-path": defaultPath,
    // The default link target varies with the recipient kind, so the
    // editor re-fetches placeholders when this field changes.
    "x-token-defaults-deps": ["recipientKind"],
  };
}

/**
 * Notifies configured recipients when a T631 job interview transitions INTO
 * the config's target status. Each config targets one status and one recipient
 * kind (the interview's worker, the job's associated employer contacts, or
 * specific staff users). Message content is composed by the framework from
 * token templates (`tokenTemplates`): the defaults above, overridden per
 * config via `data.templates`.
 *
 * `shouldDispatch` fires only on real transitions into the target status
 * (creation at that status counts; same-status re-saves and deletes never
 * fire; legacy emits without `previousStatus` are skipped to be safe).
 */
export const sitespecificT631InterviewNotifier: EventNotifierPlugin = {
  id: PLUGIN_ID,
  name: "T631 Interview Status Notifier",
  description:
    "Notifies the worker, the job's employer contacts, or selected staff when a job interview transitions into a chosen status.",
  order: 100,
  requiredComponent: "sitespecific.t631.interviews",
  subscribedEvents: [EventType.SITESPECIFIC_T631_INTERVIEW_SAVED],
  supportedMedia: ["email", "sms", "inapp"],
  configSchema: {
    type: "object",
    required: ["targetStatus", "recipientKind"],
    properties: {
      targetStatus: {
        type: "string",
        title: "Interview status",
        description:
          "Send a notification when an interview transitions into this status.",
        enum: [...STATUS_VALUES],
        enumNames: STATUS_VALUES.map(statusLabel),
      },
      recipientKind: {
        type: "string",
        title: "Recipient",
        description:
          "Who receives the notification: the interview's worker, all employer contacts associated with the job, or specific staff users.",
        enum: ["worker", "employer", "staff"],
        enumNames: ["Worker", "Employer contacts on the job", "Staff"],
      },
      staffRecipientUserIds: {
        type: "array",
        title: "Staff recipients",
        description:
          'Staff or admin users to notify. Only used when Recipient is "Staff".',
        items: { type: "string" },
        "x-widget": "staff-recipients",
      },
      // Per-channel message templates. Every field is a token template;
      // the client seeds each field with the default text and only stores
      // an override when the admin diverges from it — untouched (blank)
      // fields keep falling back to the notifier's default at runtime.
      templates: {
        type: "object",
        title: "Message templates",
        properties: {
          email: {
            type: "object",
            title: "Email",
            properties: {
              subject: templateField("Subject", "email.subject"),
              bodyHtml: templateField("Body (HTML)", "email.bodyHtml", "html"),
            },
          },
          sms: {
            type: "object",
            title: "SMS",
            properties: {
              message: templateField("Message", "sms.message", "multiline"),
            },
          },
          inapp: {
            type: "object",
            title: "In-app",
            properties: {
              title: templateField("Title", "inapp.title"),
              body: templateField("Body", "inapp.body", "multiline"),
              linkUrl: templateField("Link URL (relative)", "inapp.linkUrl"),
            },
          },
        },
      },
    },
    // Employers only ever see interviews in EMPLOYER_VISIBLE_STATUSES (the
    // T631 routes hide the rest), so an employer-targeted config may not
    // reference a hidden status. Mirrored at runtime in shouldDispatch.
    allOf: [
      {
        if: { properties: { recipientKind: { enum: ["employer"] } } },
        then: {
          properties: {
            targetStatus: { enum: [...EMPLOYER_VISIBLE_STATUSES] },
          },
        },
      },
    ],
  },

  tokenTemplates: {
    eventEntityKind: T631_INTERVIEW_ENTITY_KIND,
    async buildEventEntity(ctx) {
      const payload = payloadOf(ctx);
      const { storage } = await import("../../../storage");
      const { sitespecificT631JobInterviews } = await import(
        "../../../../shared/schema/sitespecific/t631/interviews-schema"
      );
      const row = await storage.t631Interviews.get(payload.interviewId);
      if (!row) return null;
      return {
        kind: T631_INTERVIEW_ENTITY_KIND,
        row: row as unknown as Record<string, unknown>,
        table: sitespecificT631JobInterviews,
      };
    },
    defaultTemplates,
    // Real-record preview is provided by the generic token preview-entity
    // registry (registered alongside the interview token plugins).
  },

  shouldDispatch(ctx, configData): boolean {
    const { status, previousStatus, isDeleted } = payloadOf(ctx);
    if (isDeleted) return false;
    // Legacy emits without the transition fields: skip to be safe.
    if (previousStatus === undefined) return false;
    const { targetStatus, recipientKind } = configOf(configData);
    if (!targetStatus) return false;
    // Employers only ever see interviews in EMPLOYER_VISIBLE_STATUSES — the
    // T631 routes 404 other statuses to employer callers, and a notification
    // must not leak what the UI/API hides. Enforced here (runtime) and in the
    // config schema (save time); this guard also covers pre-existing configs.
    if (
      recipientKind === "employer" &&
      !EMPLOYER_VISIBLE_STATUSES.has(targetStatus as InterviewStatus)
    ) {
      return false;
    }
    // Fire only on a real transition INTO the target status (creation at the
    // target status counts: previousStatus is null ≠ status).
    return status === targetStatus && previousStatus !== status;
  },

  async getRecipients(ctx, configData): Promise<NotifierRecipient[]> {
    const payload = payloadOf(ctx);
    const cfg = configOf(configData);
    const { storage } = await import("../../../storage");

    if (cfg.recipientKind === "worker") {
      const worker = await storage.workers.getWorker(payload.workerId);
      if (!worker?.contactId) return [];
      // Resolve the worker's user (by contact email) so in-app delivery and
      // self-suppression can match them.
      const contact = await storage.contacts.getContact(worker.contactId);
      const user = contact?.email
        ? await storage.users.getUserByEmail(contact.email)
        : undefined;
      return [{ contactId: worker.contactId, userId: user?.id ?? null }];
    }

    if (cfg.recipientKind === "employer") {
      const associations = await storage.dispatchJobEmployerContacts.listByJob(
        payload.jobId,
      );
      const byContact = new Map<string, NotifierRecipient>();
      for (const assoc of associations) {
        const contactId = assoc.contact?.id;
        if (!contactId || byContact.has(contactId)) continue;
        const email = assoc.contact?.email;
        const user = email ? await storage.users.getUserByEmail(email) : undefined;
        byContact.set(contactId, { contactId, userId: user?.id ?? null });
      }
      return Array.from(byContact.values());
    }

    // staff: resolve the config's picked user ids the same way the framework's
    // staff-mode notifiers do (userId → user email → contact). This plugin
    // cannot use the global staff-notification mode because the recipient kind
    // is chosen per config. Dedupe by contact — duplicate ids in the config or
    // distinct users sharing a contact must not produce duplicate sends.
    const staff = await resolveStaffRecipients(
      Array.from(new Set(cfg.staffRecipientUserIds)),
      PLUGIN_ID,
    );
    const byContact = new Map<string, NotifierRecipient>();
    for (const r of staff) {
      if (!byContact.has(r.contactId)) byContact.set(r.contactId, r);
    }
    return Array.from(byContact.values());
  },
};

registerEventNotifier(sitespecificT631InterviewNotifier);

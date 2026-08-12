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
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotificationMedium,
  type NotifierMessageContent,
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
  emailSubject: string;
  emailIntroHtml: string;
  textIntro: string;
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
    emailSubject: typeof data.emailSubject === "string" ? data.emailSubject.trim() : "",
    emailIntroHtml:
      typeof data.emailIntroHtml === "string" ? data.emailIntroHtml.trim() : "",
    textIntro: typeof data.textIntro === "string" ? data.textIntro.trim() : "",
  };
}

/**
 * Absolute base URL for links that leave the app (email/SMS). In-app messages
 * navigate with a relative path instead. Mirrors the domain resolution used by
 * the other notifiers in this directory.
 */
function absoluteUrl(relative: string): string {
  const domain =
    process.env.REPLIT_DEV_DOMAIN ||
    process.env.REPLIT_DOMAINS?.split(",")[0] ||
    "localhost:5000";
  return `https://${domain}${relative}`;
}

/**
 * The page a recipient is linked to. Workers land on their own interviews tab;
 * employer contacts and staff land on the job's interviews page.
 */
function linkFor(
  recipientKind: InterviewNotifierConfig["recipientKind"],
  payload: SitespecificT631InterviewSavedPayload,
): { relative: string; label: string } {
  if (recipientKind === "worker") {
    return {
      relative: `/workers/${payload.workerId}/dispatch/sitespecific_t631_interviews`,
      label: "View Interview",
    };
  }
  return {
    relative: `/dispatch/job/${payload.jobId}/sitespecific_t631_interviews`,
    label: "View Interviews",
  };
}

/** Escape a string for embedding into generated HTML. */
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

/**
 * Generated sentence describing the transition, appended after the admin's
 * intro on every medium. Names the worker and job so the message is meaningful
 * without opening the app.
 */
async function generatedText(
  payload: SitespecificT631InterviewSavedPayload,
): Promise<string> {
  const { storage } = await import("../../../storage");
  const [workerName, job] = await Promise.all([
    storage.workers.getWorkerDisplayName(payload.workerId),
    storage.dispatchJobs.get(payload.jobId),
  ]);
  const jobTitle = job?.title || "a dispatch job";
  return `The interview for ${workerName} on the job "${jobTitle}" is now ${statusLabel(payload.status)}.`;
}

/**
 * Notifies configured recipients when a T631 job interview transitions INTO
 * the config's target status. Each config targets one status and one recipient
 * kind (the interview's worker, the job's associated employer contacts, or
 * specific staff users), with admin-customizable subject/intro text per
 * medium; the generated transition sentence and a link are always appended.
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
      emailSubject: {
        type: "string",
        title: "Email subject",
        description: "Subject line for email notifications. Leave blank for a default.",
      },
      emailIntroHtml: {
        type: "string",
        title: "Email intro (HTML)",
        description:
          "Rich-text intro placed at the top of email notifications. Generated text with a link is appended after it.",
      },
      textIntro: {
        type: "string",
        title: "SMS / in-app intro (plain text)",
        description:
          "Plain-text intro for SMS and in-app notifications. Generated text with a link is appended after it.",
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
  uiSchema: {
    emailIntroHtml: { "ui:widget": "htmlEditor" },
    textIntro: { "ui:widget": "textarea" },
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

  async getMessage(
    medium: NotificationMedium,
    _recipient: NotifierRecipient,
    ctx: EventNotifierEventContext,
    configData?: unknown,
  ): Promise<NotifierMessageContent | null> {
    const payload = payloadOf(ctx);
    const cfg = configOf(configData);
    const generated = await generatedText(payload);
    const link = linkFor(cfg.recipientKind, payload);
    const external = absoluteUrl(link.relative);
    const defaultTitle = `Interview ${statusLabel(payload.status)}`;

    switch (medium) {
      case "email": {
        // The admin's HTML intro comes from the rich-text editor; re-sanitize
        // server-side (defense in depth — a direct API write bypasses the
        // editor) before embedding it in the outgoing email.
        const { sanitizeHelpHtml } = await import("../../../help/sanitize");
        const { htmlToPlainText } = await import(
          "../../../../shared/bulk-tokens/html-to-text"
        );
        const introHtml = cfg.emailIntroHtml ? sanitizeHelpHtml(cfg.emailIntroHtml) : "";
        const introText = introHtml ? htmlToPlainText(introHtml) : "";
        const bodyHtml =
          (introHtml ? `${introHtml}\n` : "") +
          `<p>${escapeHtml(generated)}</p>` +
          `<p><a href="${escapeHtml(external)}">${escapeHtml(link.label)}</a></p>`;
        const bodyText =
          (introText ? `${introText}\n\n` : "") +
          `${generated}\n\n${link.label}: ${external}`;
        return {
          subject: cfg.emailSubject || defaultTitle,
          bodyText,
          bodyHtml,
        };
      }
      case "sms": {
        const intro = cfg.textIntro ? `${cfg.textIntro} ` : "";
        return { message: `${intro}${generated} View: ${external}` };
      }
      case "inapp": {
        const intro = cfg.textIntro ? `${cfg.textIntro} ` : "";
        return {
          title: defaultTitle,
          body: `${intro}${generated}`,
          linkUrl: link.relative,
          linkLabel: link.label,
        };
      }
      default:
        return null;
    }
  },
};

registerEventNotifier(sitespecificT631InterviewNotifier);

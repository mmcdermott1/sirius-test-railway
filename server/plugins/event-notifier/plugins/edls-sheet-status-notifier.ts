import {
  EventType,
  type EdlsSheetSavedPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import { templatesSchemaBlock } from "../template-schema";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotifierChannelTemplates,
  type NotifierRecipient,
} from "../types";

function payloadOf(ctx: EventNotifierEventContext): EdlsSheetSavedPayload {
  return ctx.payload as EdlsSheetSavedPayload;
}

/**
 * Read a required string-array config field off a config's `data`. Both the
 * trigger statuses and the recipient roles are REQUIRED for this notifier: an
 * empty list means the config can never fire (shouldDispatch returns false) or
 * notifies nobody (getRecipients returns []), so a misconfigured config never
 * silently blasts everyone.
 */
function configuredValues(configData: unknown, key: string): string[] {
  const data =
    configData && typeof configData === "object"
      ? (configData as Record<string, unknown>)
      : {};
  const values = data[key];
  if (!Array.isArray(values)) return [];
  return values.filter((v): v is string => typeof v === "string");
}

const RECIPIENT_SHEET_SUPERVISOR = "sheet_supervisor";
const RECIPIENT_SHEET_ASSIGNEE = "sheet_assignee";
const RECIPIENT_CREW_SUPERVISORS = "crew_supervisors";

const PLUGIN_ID = "edls-sheet-status-notifier";

/** Display labels for sheet statuses, merged onto the event entity as
 * `status_label` so the default wording matches the pre-token notifier
 * ("Locked", not "lock"). Raw `status` stays available for templates. */
export const EDLS_STATUS_LABELS: Record<string, string> = {
  draft: "Draft",
  request: "Request",
  lock: "Locked",
  trash: "Trash",
  reserved: "Reserved",
};

export function edlsStatusLabel(status: string): string {
  return EDLS_STATUS_LABELS[status] ?? status;
}

/** Legacy display name for a sheet: the (non-blank) title, else
 * `Sheet <id-prefix>` — merged onto the event entity as `display_title`. */
export function edlsSheetDisplayTitle(sheetId: string, title: string): string {
  return title && title.trim() ? title : `Sheet ${sheetId.slice(0, 8)}`;
}

/** Default per-channel templates, rendered against a payload snapshot of
 * the transition (an intervening save must not change the message). */
const TITLE = '{{event.field(name="display_title")}}';
const SENTENCE =
  'The EDLS sheet "{{event.field(name="display_title")}}" ' +
  '({{event.field(name="ymd_display")}}) has reached the status ' +
  '"{{event.field(name="status_label")}}".';
const LINK_PATH = '/edls/sheet/{{event.field(name="id")}}';
const LINK_LABEL = "View Sheet";

function defaultTemplates(): NotifierChannelTemplates {
  return {
    email: {
      subject: TITLE,
      bodyHtml:
        `<p>${SENTENCE}<br><br>` +
        `View the sheet: ` +
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
 * Notifies the staff users attached to an EDLS sheet whenever the sheet
 * ARRIVES at one of the admin-selected trigger statuses — via a status change,
 * or by being created directly in a configured status (create carries
 * `previousStatus: null`, which never equals a real status, so it always
 * counts as an arrival). Edits that leave the status unchanged never fire.
 *
 * WHO is notified is driven by the required `recipientTypes` config: the
 * sheet's supervisor, the sheet's assignee, and/or the supervisors of the
 * sheet's crews — all staff users, never workers. Recipients are deduped by
 * contact so a user holding several roles (e.g. supervisor AND assignee) is
 * notified once. The user who performed the action is dropped by the
 * dispatcher's self-notification suppression (recipients carry their
 * `userId`).
 */
export const edlsSheetStatusNotifier: EventNotifierPlugin = {
  id: "edls-sheet-status-notifier",
  name: "EDLS Sheet Status Notifier",
  description:
    "Notifies the sheet supervisor, sheet assignee, and/or crew supervisors when an EDLS sheet arrives at one of the selected statuses (including being created in one).",
  order: 100,
  requiredComponent: "edls",
  subscribedEvents: [EventType.EDLS_SHEET_SAVED],
  supportedMedia: ["inapp", "email", "sms"],
  configSchema: {
    type: "object",
    required: ["statuses", "recipientTypes"],
    properties: {
      statuses: {
        type: "array",
        title: "Trigger statuses",
        description:
          "Notify when a sheet arrives at one of these statuses (by status change, or by being created in one). At least one status is required.",
        minItems: 1,
        uniqueItems: true,
        items: {
          type: "string",
          enum: ["draft", "request", "lock", "trash", "reserved"],
          enumNames: ["Draft", "Request", "Locked", "Trash", "Reserved"],
        },
      },
      recipientTypes: {
        type: "array",
        title: "Notify",
        description:
          "Which of the sheet's staff to notify. At least one is required — with none selected, nobody is notified.",
        minItems: 1,
        uniqueItems: true,
        items: {
          type: "string",
          enum: [
            RECIPIENT_SHEET_SUPERVISOR,
            RECIPIENT_SHEET_ASSIGNEE,
            RECIPIENT_CREW_SUPERVISORS,
          ],
          enumNames: [
            "Sheet supervisor",
            "Sheet assignee",
            "Crew supervisors",
          ],
        },
      },
      templates: templatesSchemaBlock(PLUGIN_ID, {
        exampleTokens: [
          '{{event.field(name="title")}}',
          '{{event.field(name="status")}}',
        ],
      }),
    },
  },

  tokenTemplates: {
    eventEntityKind: "edls_sheet",
    async buildEventEntity(ctx) {
      const { sheetId, newStatus, title, ymd } = payloadOf(ctx);
      const { storage } = await import("../../../storage");
      const { edlsSheets } = await import(
        "../../../../shared/schema/edls/schema"
      );
      // Render the transition this event describes, not the live row: an
      // intervening save (or delete) must not change — or swallow — the
      // notification. The live row only backfills fields the payload
      // doesn't carry (employer, department, …) for custom templates.
      const row = await storage.edlsSheets.get(sheetId);
      return {
        kind: "edls_sheet",
        row: {
          ...((row as unknown as Record<string, unknown>) ?? {}),
          id: sheetId,
          status: newStatus,
          statusLabel: edlsStatusLabel(newStatus),
          title,
          displayTitle: edlsSheetDisplayTitle(sheetId, title),
          ymd,
          // The legacy body interpolated the raw payload date string
          // ("2026-01-08"); the ymd date column would auto-format.
          ymdDisplay: ymd,
        },
        table: edlsSheets,
      };
    },
    defaultTemplates,
  },

  shouldDispatch(ctx, configData): boolean {
    const { previousStatus, newStatus } = payloadOf(ctx);
    // Only a genuine ARRIVAL at a configured status. Creates carry
    // previousStatus: null, so a sheet created directly in a configured
    // status fires; edits that leave the status unchanged never do.
    if (!newStatus) return false;
    if (newStatus === previousStatus) return false;
    const triggers = new Set(configuredValues(configData, "statuses"));
    if (triggers.size === 0) return false;
    return triggers.has(newStatus);
  },

  async getRecipients(ctx, configData): Promise<NotifierRecipient[]> {
    const wanted = new Set(configuredValues(configData, "recipientTypes"));
    // Recipient selection is required — none selected means notify nobody.
    if (wanted.size === 0) return [];

    const { sheetId } = payloadOf(ctx);
    const { storage } = await import("../../../storage");

    // Collect the wanted users (staff only — workers are never notified).
    const userMap = new Map<string, { userId: string; email: string }>();
    const addUser = (
      u: { id: string; email: string } | undefined,
    ): void => {
      if (u?.id && u.email && !userMap.has(u.id)) {
        userMap.set(u.id, { userId: u.id, email: u.email });
      }
    };

    if (
      wanted.has(RECIPIENT_SHEET_SUPERVISOR) ||
      wanted.has(RECIPIENT_SHEET_ASSIGNEE)
    ) {
      const sheet = await storage.edlsSheets.getWithRelations(sheetId);
      if (sheet) {
        if (wanted.has(RECIPIENT_SHEET_SUPERVISOR)) addUser(sheet.supervisorUser);
        if (wanted.has(RECIPIENT_SHEET_ASSIGNEE)) addUser(sheet.assigneeUser);
      }
    }

    if (wanted.has(RECIPIENT_CREW_SUPERVISORS)) {
      const crews = await storage.edlsCrews.getBySheetIdWithRelations(sheetId);
      for (const crew of crews) addUser(crew.supervisorUser);
    }

    if (userMap.size === 0) return [];

    const resolved = await Promise.all(
      Array.from(userMap.values()).map(async (u) => {
        const contact = await storage.contacts.getContactByEmail(u.email);
        return contact ? { contactId: contact.id, userId: u.userId } : null;
      }),
    );

    // Several roles may resolve to the same contact; dedupe so each person is
    // notified once per arrival.
    const byContact = new Map<string, NotifierRecipient>();
    for (const r of resolved) {
      if (r && !byContact.has(r.contactId)) byContact.set(r.contactId, r);
    }
    return Array.from(byContact.values());
  },
};

registerEventNotifier(edlsSheetStatusNotifier);

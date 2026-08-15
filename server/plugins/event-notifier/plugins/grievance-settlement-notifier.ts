import {
  EventType,
  type GrievanceSettlementSavedPayload,
} from "../../../services/event-bus";
import { registerEventNotifier } from "../registry";
import { templatesSchemaBlock } from "../template-schema";
import {
  type EventNotifierEventContext,
  type EventNotifierPlugin,
  type NotifierChannelTemplates,
  type NotifierRecipient,
} from "../types";

function payloadOf(ctx: EventNotifierEventContext): GrievanceSettlementSavedPayload {
  return ctx.payload as GrievanceSettlementSavedPayload;
}

/**
 * Read the admin-configured grievance role filter off a config's `data`. Role
 * selection is REQUIRED for this notifier: an empty list means "notify nobody"
 * (getRecipients returns an empty array), so a misconfigured config never
 * silently blasts everyone.
 */
function configuredRoleIds(configData: unknown): string[] {
  const data =
    configData && typeof configData === "object"
      ? (configData as Record<string, unknown>)
      : {};
  const ids = data.roleIds;
  if (!Array.isArray(ids)) return [];
  return ids.filter((v): v is string => typeof v === "string");
}

const PLUGIN_ID = "grievance-settlement-notifier";

/**
 * Default per-channel templates. The event entity is the settlement row
 * (reconstructed from the payload for deletes, whose row is gone by
 * delivery time) with the event's `operation` (created/updated/deleted)
 * merged on, so the default sentence stays grammatical for all three.
 */
const TITLE = '{{event.field(name="grievance_title")}}';
const SENTENCE = '{{event.field(name="summary")}}';

/** Settlement amount as US currency ("$100", "$100.50"); null when the
 * amount is missing or unparsable (the sentence then omits it). */
export function formatAmount(amount: string | null | undefined): string | null {
  if (amount == null) return null;
  const num = Number(amount);
  if (!Number.isFinite(num)) return null;
  const hasCents = Math.round(num * 100) % 100 !== 0;
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: hasCents ? 2 : 0,
    maximumFractionDigits: 2,
  }).format(num);
}

/**
 * The exact legacy sentence for each operation — merged onto the event
 * entity as `summary` so the default templates reproduce the pre-token
 * wording verbatim (word order, unquoted title, and the amount clause
 * dropped entirely when the amount is missing).
 */
export function settlementSummary(
  operation: GrievanceSettlementSavedPayload["operation"],
  grievanceTitle: string,
  amount: string | null | undefined,
): string {
  const money = formatAmount(amount);
  const settlement = money ? `A settlement of ${money}` : `A settlement`;
  switch (operation) {
    case "created":
      return `${settlement} was added to the grievance ${grievanceTitle}.`;
    case "deleted":
      return `${settlement} was removed from the grievance ${grievanceTitle}.`;
    case "updated":
    default:
      return `${settlement} on the grievance ${grievanceTitle} was updated.`;
  }
}
const LINK_PATH =
  '/grievance/{{event.grievance.field(name="id")}}/settlements';
const LINK_LABEL = "View Settlements";

function defaultTemplates(): NotifierChannelTemplates {
  return {
    email: {
      subject: TITLE,
      bodyHtml:
        `<p>${SENTENCE}<br><br>` +
        `View the settlement: ` +
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
 * Notifies the users associated with a grievance whenever a settlement on that
 * grievance is added, updated, or removed. The settlement storage emits
 * `GRIEVANCE_SETTLEMENT_SAVED` and this plugin fans it out over the admin's
 * selected media (in-app / email / SMS — never postal).
 *
 * WHO is notified is driven by the required `roleIds` config: only associated
 * users holding one of the selected grievance roles receive the notice. The
 * user who performed the action is dropped by the dispatcher's self-notification
 * suppression (recipients carry their `userId`).
 */
export const grievanceSettlementNotifier: EventNotifierPlugin = {
  id: "grievance-settlement",
  name: "Grievance Settlement Notifier",
  description:
    "Notifies grievance-associated users (by selected role) when a settlement is added, updated, or removed.",
  order: 100,
  requiredComponent: "grievance.settlement",
  subscribedEvents: [EventType.GRIEVANCE_SETTLEMENT_SAVED],
  supportedMedia: ["inapp", "email", "sms"],
  configSchema: {
    type: "object",
    required: ["roleIds"],
    properties: {
      roleIds: {
        type: "array",
        title: "Notify roles",
        description:
          "Notify grievance-associated users who hold one of these roles. At least one role is required — with none selected, nobody is notified.",
        minItems: 1,
        items: { type: "string" },
        "x-options-resource": "grievance-role",
      },
      templates: templatesSchemaBlock(PLUGIN_ID, {
        exampleTokens: [
          '{{event.grievance.field(name="name")}}',
          '{{event.field(name="amount")}}',
          '{{event.field(name="operation")}}',
        ],
      }),
    },
  },

  tokenTemplates: {
    eventEntityKind: "grievance_settlement",
    async buildEventEntity(ctx) {
      const { grievanceId, settlementId, operation, amount } = payloadOf(ctx);
      const { storage } = await import("../../../storage");
      const { grievanceSettlements } = await import(
        "../../../../shared/schema/grievance/settlement-schema"
      );
      const { composeGrievanceDisplayTitle } = await import(
        "../../tokens/plugins/grievance"
      );
      // For deletes the row is gone by delivery time — reconstruct a
      // minimal snapshot from the payload so delete notices still render.
      const [row, titleInfo] = await Promise.all([
        operation === "deleted"
          ? undefined
          : storage.grievanceSettlements.get(grievanceId, settlementId),
        storage.grievances.getAssignmentTitleInfo(grievanceId),
      ]);
      const base = (row ?? { id: settlementId, grievanceId, amount }) as Record<
        string,
        unknown
      >;
      const grievanceTitle = composeGrievanceDisplayTitle(
        grievanceId,
        titleInfo,
      );
      return {
        kind: "grievance_settlement",
        row: {
          ...base,
          operation,
          grievanceTitle,
          // The payload's amount reflects the change being notified (the
          // loaded row could already carry a later edit's amount).
          summary: settlementSummary(operation, grievanceTitle, amount),
        },
        table: grievanceSettlements,
      };
    },
    defaultTemplates,
  },

  async getRecipients(ctx, configData): Promise<NotifierRecipient[]> {
    const allowed = new Set(configuredRoleIds(configData));
    // Role selection is required — no roles means notify nobody.
    if (allowed.size === 0) return [];

    const { grievanceId } = payloadOf(ctx);
    const { storage } = await import("../../../storage");
    const users = await storage.grievances.listUsers(grievanceId);
    const matched = users.filter(
      (u) => u.roleId != null && allowed.has(u.roleId) && !!u.email,
    );
    if (matched.length === 0) return [];

    const resolved = await Promise.all(
      matched.map(async (u) => {
        const contact = await storage.contacts.getContactByEmail(u.email!);
        return contact ? { contactId: contact.id, userId: u.userId } : null;
      }),
    );

    // A user may hold more than one matching role; dedupe by contact so they
    // are notified once per settlement change.
    const byContact = new Map<string, NotifierRecipient>();
    for (const r of resolved) {
      if (r && !byContact.has(r.contactId)) byContact.set(r.contactId, r);
    }
    return Array.from(byContact.values());
  },
};

registerEventNotifier(grievanceSettlementNotifier);

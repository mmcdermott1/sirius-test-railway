import type { JsonSchema, UiSchema } from "@shared/json-schema-form";
import type { EventType } from "../../services/event-bus";
import type { BasePluginMetadata } from "../_core";
import type { TokenEntity } from "../tokens/types";

/**
 * The communication media an event-notifier can fan out to. Each maps to one
 * of the comm send functions (`sendEmail`, `sendSms`, `sendInapp`,
 * `sendPostal`). A plugin declares which media it is *capable* of producing a
 * message for (its `supportedMedia`); the admin selects the *active* subset per
 * config (persisted on the subsidiary `media` column).
 */
export type NotificationMedium = "email" | "sms" | "inapp" | "postal";

export const ALL_NOTIFICATION_MEDIA: readonly NotificationMedium[] = [
  "email",
  "sms",
  "inapp",
  "postal",
];

/**
 * A resolved recipient for a fired event. `contactId` anchors every send (the
 * comm layer keys delivery, opt-outs and tagging off it). `userId` is required
 * only for in-app messages (they deliver to an authenticated user); resolve it
 * (e.g. via `storage.users.getUserByEmail`) when the notifier supports in-app.
 */
export interface NotifierRecipient {
  contactId: string;
  userId?: string | null;
}

/**
 * The per-medium message content a notifier composes for one recipient. Only
 * the fields relevant to the medium being sent are read; the send wrapper picks
 * them out and ignores the rest. Returning `null` from {@link
 * EventNotifierPlugin.getMessage} skips that medium for that recipient.
 */
export interface NotifierMessageContent {
  // email
  subject?: string;
  bodyText?: string;
  bodyHtml?: string;
  // sms
  message?: string;
  // inapp
  title?: string;
  body?: string;
  linkUrl?: string;
  linkLabel?: string;
  // postal
  file?: string;
  templateId?: string;
  description?: string;
  mergeVariables?: Record<string, string>;
}

/**
 * Context handed to a notifier for a single fired event. `event` is the bus
 * event type and `payload` is its (untyped here) payload — the notifier
 * narrows it against the event-bus `EventPayloadMap`.
 */
export interface EventNotifierEventContext {
  event: EventType;
  payload: unknown;
}

/**
 * Per-channel message templates for a token-templated notifier. Every
 * value is a token template string rendered per recipient (recipient
 * roots like `contact.`/`worker.` mean the recipient; `event.` means
 * the entity the event is about; `{{system.base_url}}` is the absolute
 * origin on email/SMS and empty in-app).
 */
export interface NotifierChannelTemplates {
  email?: {
    subject: string;
    /** HTML body; token values are HTML-escaped on render. */
    bodyHtml: string;
  };
  sms?: { message: string };
  inapp?: {
    title: string;
    body: string;
    /** Relative link (in-app navigation); rendered as a template too. */
    linkUrl?: string;
    linkLabel?: string;
  };
}

/**
 * Opt-in declaration that a notifier's messages are composed by the
 * FRAMEWORK from token templates instead of the plugin's `getMessage`.
 * Custom per-channel templates live in the config's `data.templates`
 * (same shape as {@link NotifierChannelTemplates}); a blank/absent
 * custom field falls back to the default from `defaultTemplates`.
 */
export interface NotifierTokenTemplates {
  /** The entity kind `{{event...}}` resolves to (token entity kind). */
  eventEntityKind: string;
  /**
   * Load the event's entity (full row) for a fired event. Returning
   * null aborts message composition for this config (already-deleted
   * rows etc.) — nothing is sent.
   */
  buildEventEntity(ctx: EventNotifierEventContext): Promise<TokenEntity | null>;
  /**
   * The default per-channel templates. Receives the config's `data` so
   * defaults can vary with config choices (e.g. link target per
   * recipient kind).
   */
  defaultTemplates(configData?: unknown): NotifierChannelTemplates;
}

/**
 * An event-notifier plugin. It subscribes to one or more event-bus events and
 * fans each fired event out to the comm send functions for every active
 * medium. The framework (the event-notifier "send wrapper") owns subscription,
 * config resolution, medium gating and the actual sends; a plugin only:
 *   - declares which events it cares about (`subscribedEvents`),
 *   - declares which media it can produce (`supportedMedia`),
 *   - resolves recipients for a fired event (`getRecipients`), and
 *   - composes the message for one recipient on one medium (`getMessage`).
 */
export interface EventNotifierPlugin extends BasePluginMetadata {
  /** Ordering hint mirrored onto manifest entries (ascending). */
  order?: number;
  /**
   * When true, this notifier targets a fixed list of internal staff/admin
   * users chosen per config rather than recipients derived from the event
   * payload. The framework resolves the recipients itself from the config's
   * `data.staffRecipientUserIds` (userId → user email → contact), so a
   * staff-mode plugin omits {@link getRecipients}.
   */
  staffNotification?: boolean;
  /**
   * When true, the dispatcher does NOT drop the acting user from the recipient
   * list (its "self-notification suppression"). Suppression exists so a user
   * who just performed an action isn't notified about their own real-time
   * change; but for scheduled EBS-pump reminders (e.g. "2 days until this
   * grievance's deadline") the recipient legitimately wants the reminder even
   * if they created or last touched the entity — and manually running the pump
   * would otherwise suppress the operator. Defaults to false (suppress).
   */
  notifySelf?: boolean;
  /**
   * JSON Schema describing the editable `data` fields the generic admin UI
   * renders for a config row of this notifier. Omit for notifiers with no
   * editable settings.
   */
  configSchema?: JsonSchema;
  /** Optional RJSF UI hints paired with {@link configSchema}. */
  uiSchema?: UiSchema;

  /**
   * Opt-in token-template message composition. When declared, the
   * dispatcher renders the per-channel templates (custom from
   * `data.templates`, else the declared defaults) and the plugin's
   * {@link getMessage} is not called. Notifiers without this
   * declaration are untouched.
   */
  tokenTemplates?: NotifierTokenTemplates;

  /** Event-bus events this notifier subscribes to. */
  subscribedEvents: EventType[];
  /** The media this notifier is capable of producing a message for. */
  supportedMedia: NotificationMedium[];

  /**
   * Resolve the recipients for a fired event. An empty array means "nobody to
   * notify" and the framework sends nothing. Omitted by staff-mode notifiers
   * ({@link staffNotification}): the framework resolves their recipients from
   * the config instead.
   */
  getRecipients?(
    ctx: EventNotifierEventContext,
    configData?: unknown,
  ): Promise<NotifierRecipient[]>;

  /**
   * Optional per-config gate evaluated before recipients are resolved. Receives
   * the fired event context and the individual config's `data` payload; return
   * `false` to skip this config for this event (e.g. the config restricts
   * notifications to a subset of roles that does not include the one on the
   * payload). Notifiers that omit this hook always dispatch.
   */
  shouldDispatch?(
    ctx: EventNotifierEventContext,
    configData: unknown,
  ): boolean | Promise<boolean>;

  /**
   * Compose the message for one recipient on one medium. Return `null` to skip
   * that medium for that recipient (e.g. the recipient has no address on file,
   * or the content does not apply). `configData` is the individual config's
   * `data` payload, for notifiers whose message text is admin-configurable
   * (e.g. a per-config subject/intro); plugins that don't need it ignore it.
   * Optional for notifiers that declare {@link tokenTemplates} — the
   * framework composes their messages instead.
   */
  getMessage?(
    medium: NotificationMedium,
    recipient: NotifierRecipient,
    ctx: EventNotifierEventContext,
    configData?: unknown,
  ): Promise<NotifierMessageContent | null>;
}

export interface EventNotifierManifestEntry {
  id: string;
  name: string;
  description?: string;
  order: number;
  requiredComponent?: string;
  needsReadOnlyDb?: boolean;
  /** Attached by the kind's `decorateEntries` for the generic admin UI. */
  enabled?: boolean;
  configSchema?: JsonSchema;
  uiSchema?: UiSchema;
}

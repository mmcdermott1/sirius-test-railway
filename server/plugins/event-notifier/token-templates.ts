import { logger } from "../../logger";
import type {
  EventNotifierPlugin,
  NotificationMedium,
  NotifierChannelTemplates,
  NotifierMessageContent,
  NotifierRecipient,
} from "./types";
import type { TokenEntity } from "../tokens/types";

const SERVICE = "event-notifier-token-templates";

/**
 * Read the admin's custom per-channel templates off a config's `data`
 * payload (`data.templates`). Unknown/malformed values degrade to "no
 * override" — the default template applies.
 */
function customTemplatesOf(configData: unknown): Record<string, Record<string, unknown>> {
  const data =
    configData && typeof configData === "object"
      ? (configData as Record<string, unknown>)
      : {};
  const t = data.templates;
  if (!t || typeof t !== "object") return {};
  const out: Record<string, Record<string, unknown>> = {};
  for (const [channel, val] of Object.entries(t as Record<string, unknown>)) {
    if (val && typeof val === "object") out[channel] = val as Record<string, unknown>;
  }
  return out;
}

/** Same-app relative path: starts with "/", not scheme-relative "//". */
export function isSafeRelativePath(url: string): boolean {
  return url.startsWith("/") && !url.startsWith("//") && !url.startsWith("/\\");
}

/** A custom field wins only when it is a non-blank string. */
function pick(custom: unknown, fallback: string | undefined): string {
  return typeof custom === "string" && custom.trim() !== "" ? custom : (fallback ?? "");
}

/**
 * Effective per-channel templates for one config: the plugin's defaults
 * (computed with the config's data) overridden field-by-field by the
 * admin's custom templates. Blank custom fields keep the default.
 */
export function resolveTemplates(
  plugin: EventNotifierPlugin,
  configData: unknown,
): NotifierChannelTemplates {
  const defaults = plugin.tokenTemplates!.defaultTemplates(configData);
  const custom = customTemplatesOf(configData);
  return {
    email: defaults.email && {
      subject: pick(custom.email?.subject, defaults.email.subject),
      bodyHtml: pick(custom.email?.bodyHtml, defaults.email.bodyHtml),
    },
    sms: defaults.sms && {
      message: pick(custom.sms?.message, defaults.sms.message),
    },
    inapp: defaults.inapp && {
      title: pick(custom.inapp?.title, defaults.inapp.title),
      body: pick(custom.inapp?.body, defaults.inapp.body),
      linkUrl: pick(custom.inapp?.linkUrl, defaults.inapp.linkUrl),
      linkLabel: pick(custom.inapp?.linkLabel, defaults.inapp.linkLabel),
    },
  };
}

/**
 * Compose the message for one (recipient, medium) pair by rendering the
 * effective templates. Rendering is strict: invalid tokens surface as a
 * visible "[unknown token: …]" marker (author-time validation should
 * have caught them) and are logged. The render context carries the
 * recipient (recipient roots), the event entity (`event.` root) and the
 * medium as the audience (audience-gated tokens fail closed).
 */
export async function composeFromTemplates(
  plugin: EventNotifierPlugin,
  medium: NotificationMedium,
  recipient: NotifierRecipient,
  eventEntity: TokenEntity,
  templates: NotifierChannelTemplates,
  cache: Map<string, unknown>,
): Promise<NotifierMessageContent | null> {
  const { storage } = await import("../../storage");
  const { renderTokens, createTokenEvalContext } = await import("../tokens");

  const render = async (template: string, opts?: { escapeHtml?: boolean }) => {
    if (!template) return "";
    // A fresh context per rendered string is cheap; the shared cache
    // carries memoized lookups across strings, recipients and media.
    const ctx = createTokenEvalContext(storage, recipient.contactId, {
      audience: medium,
      cache,
      event: eventEntity,
    });
    const result = await renderTokens(template, ctx, {
      strictUnknown: true,
      escapeHtml: opts?.escapeHtml,
    });
    if (result.unknownTokens.length > 0) {
      logger.warn("Event-notifier template contained invalid tokens", {
        service: SERVICE,
        pluginId: plugin.id,
        medium,
        unknownTokens: result.unknownTokens,
      });
    }
    return result.output;
  };

  if (medium === "email" && templates.email) {
    const subject = (await render(templates.email.subject)).trim();
    if (!subject) return null;
    // Sanitize AFTER token rendering so substituted values (e.g. a token
    // used as an entire href) are subject to the tag/attr/URI allowlist
    // too — admin-authored markup is not trusted verbatim (direct API
    // writes bypass the rich-text editor). bodyText derives from the
    // sanitized HTML so both parts always agree.
    const rendered = await render(templates.email.bodyHtml, { escapeHtml: true });
    const { sanitizeHelpHtml } = await import("../../help/sanitize");
    const bodyHtml = sanitizeHelpHtml(rendered);
    const { htmlToPlainText } = await import("../../../shared/html-to-text");
    return { subject, bodyHtml, bodyText: htmlToPlainText(bodyHtml) };
  }

  if (medium === "sms" && templates.sms) {
    const message = (await render(templates.sms.message)).trim();
    return message ? { message } : null;
  }

  if (medium === "inapp" && templates.inapp) {
    const title = (await render(templates.inapp.title)).trim();
    const body = (await render(templates.inapp.body)).trim();
    if (!title || !body) return null;
    let linkUrl = templates.inapp.linkUrl
      ? (await render(templates.inapp.linkUrl)).trim()
      : "";
    // In-app links must be same-app relative paths ("/..." but not
    // scheme-relative "//..."). Alert UIs hand non-relative links to
    // window.open, so a rendered "javascript:" or absolute URL would be
    // a stored script-execution / open-redirect vector. Enforced here
    // after token substitution (save-time validation checks the raw
    // template, but a token could still render something unsafe).
    if (linkUrl && !isSafeRelativePath(linkUrl)) {
      logger.warn("Event-notifier in-app link was not a safe relative path; dropped", {
        service: SERVICE,
        pluginId: plugin.id,
        linkUrl,
      });
      linkUrl = "";
    }
    return {
      title,
      body,
      linkUrl: linkUrl || undefined,
      linkLabel: linkUrl ? templates.inapp.linkLabel || undefined : undefined,
    };
  }

  // Media the templates don't cover (e.g. postal) are skipped.
  return null;
}

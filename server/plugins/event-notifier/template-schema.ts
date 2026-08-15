/**
 * Shared JSON-Schema builder for a token-templated notifier's
 * `templates` config block. Every field is a token template wired to
 * the client's token-template widget (live token warnings, default
 * shown as placeholder, catalog fetched per plugin). Blank fields fall
 * back to the notifier's default template.
 */

/** Schema for one token-template field, wired to the token-template widget. */
export function templateField(
  pluginId: string,
  title: string,
  defaultPath: string,
  mode: "line" | "multiline" | "html" = "line",
  defaultsDeps?: string[],
): Record<string, unknown> {
  const field: Record<string, unknown> = {
    type: "string",
    title,
    "x-widget": "token-template",
    "x-token-template-mode": mode,
    "x-token-catalog-url": `/api/event-notifier/token-catalog/${pluginId}`,
    "x-token-default-path": defaultPath,
  };
  if (defaultsDeps && defaultsDeps.length > 0) {
    // The default templates vary with these config fields, so the
    // editor re-fetches placeholders when one of them changes.
    field["x-token-defaults-deps"] = defaultsDeps;
  }
  return field;
}

/**
 * The full `templates` object schema (email subject/body, SMS message,
 * in-app title/body/link) for one notifier. `exampleTokens` seeds the
 * block's description so authors see a couple of relevant tokens.
 */
export function templatesSchemaBlock(
  pluginId: string,
  opts?: { exampleTokens?: string[]; defaultsDeps?: string[] },
): Record<string, unknown> {
  const deps = opts?.defaultsDeps;
  const examples = opts?.exampleTokens?.length
    ? `Customize the message per channel with tokens like ${opts.exampleTokens.join(", ")} and {{system.base_url}}. `
    : "Customize the message per channel with tokens. ";
  const f = (title: string, path: string, mode?: "line" | "multiline" | "html") =>
    templateField(pluginId, title, path, mode, deps);
  return {
    type: "object",
    title: "Message templates",
    description: examples + "Leave a field blank to use the default.",
    properties: {
      email: {
        type: "object",
        title: "Email",
        properties: {
          subject: f("Subject", "email.subject"),
          bodyHtml: f("Body (HTML)", "email.bodyHtml", "html"),
        },
      },
      sms: {
        type: "object",
        title: "SMS",
        properties: {
          message: f("Message", "sms.message", "multiline"),
        },
      },
      inapp: {
        type: "object",
        title: "In-app",
        properties: {
          title: f("Title", "inapp.title"),
          body: f("Body", "inapp.body", "multiline"),
          linkUrl: f("Link URL (relative)", "inapp.linkUrl"),
        },
      },
    },
  };
}

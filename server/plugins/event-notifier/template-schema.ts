/**
 * Shared JSON-Schema builder for a token-templated notifier's
 * `templates` config block. EVERY token-templated notifier builds its
 * block from here — there is one framework, one client component, and
 * one UX for message templates.
 *
 * The editing UI is attached at the MEDIUM level, not the field level:
 * each channel group (email / sms / inapp) carries the
 * `notifier-channel-templates` vendor key, so the config form renders
 * one compact card per medium with a single Edit (Template Studio) and
 * a single Revert. The per-field keys below are metadata the card and
 * the Studio read (label, editor mode, where the default lives).
 *
 * A field is only stored as an override when it diverges from the
 * default — blank/untouched fields fall back to the notifier's default
 * template at runtime (see `pick()` in token-templates.ts).
 */

type TemplateMode = "line" | "multiline" | "html";

/** One token-template field: metadata only; the medium owns the editor. */
function templateField(
  title: string,
  defaultPath: string,
  mode: TemplateMode = "line",
  opts?: { optional?: boolean },
): Record<string, unknown> {
  const field: Record<string, unknown> = {
    type: "string",
    title,
    "x-token-template-mode": mode,
    "x-token-default-path": defaultPath,
  };
  if (opts?.optional) {
    // Shown only when the notifier's defaults declare it (or the admin
    // has already customized it) — e.g. a notifier with no in-app link
    // shouldn't grow a link label.
    field["x-token-optional"] = true;
  }
  return field;
}

/** One medium's group: the unit the client renders as a single card. */
function channelGroup(
  pluginId: string,
  channel: string,
  title: string,
  properties: Record<string, unknown>,
  defaultsDeps?: string[],
): Record<string, unknown> {
  const group: Record<string, unknown> = {
    type: "object",
    title,
    "x-widget": "notifier-channel-templates",
    "x-token-channel": channel,
    "x-token-plugin-id": pluginId,
    "x-token-catalog-url": `/api/event-notifier/token-catalog/${pluginId}`,
    properties,
  };
  if (defaultsDeps && defaultsDeps.length > 0) {
    // The default templates vary with these config fields, so the card
    // re-fetches the catalog when one of them changes.
    group["x-token-defaults-deps"] = defaultsDeps;
  }
  return group;
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
  const examples = opts?.exampleTokens ?? [];
  const block: Record<string, unknown> = {
    type: "object",
    title: "Message templates",
    properties: {
      email: channelGroup(
        pluginId,
        "email",
        "Email",
        {
          subject: templateField("Subject", "email.subject"),
          bodyHtml: templateField("Body (HTML)", "email.bodyHtml", "html"),
        },
        deps,
      ),
      sms: channelGroup(
        pluginId,
        "sms",
        "SMS",
        {
          message: templateField("Message", "sms.message", "multiline"),
        },
        deps,
      ),
      inapp: channelGroup(
        pluginId,
        "inapp",
        "In-app",
        {
          title: templateField("Title", "inapp.title"),
          body: templateField("Body", "inapp.body", "multiline"),
          linkUrl: templateField("Link URL (relative)", "inapp.linkUrl"),
          // Declared so a Studio edit isn't stripped by the form
          // library on save; hidden unless the notifier declares one.
          linkLabel: templateField("Link label", "inapp.linkLabel", "line", {
            optional: true,
          }),
        },
        deps,
      ),
    },
  };
  if (examples.length > 0) {
    block.description = `Leave a field untouched to keep the notifier's default. Example tokens: ${examples.join(
      " ",
    )}`;
  }
  return block;
}

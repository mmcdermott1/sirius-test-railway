import { contacts } from "@shared/schema";
import { mergeChannelFieldSpecs, registerTemplateSurface } from "../registry";
import {
  TemplateSurfaceError,
  type TemplateSurfaceContextRequest,
  type TemplateSurfacePreviewContext,
  type TemplateSurfaceResolution,
  type TemplateSurfaceResolvedContext,
} from "../types";

import { BULK_CHANNEL_FIELDS } from "../../../modules/bulk/field-media";

/** How many of the message's own recipients the studio offers. */
const RECIPIENT_LIMIT = 5;

/** Prefix marking a context id as "one recipient of this message". */
const CONTACT_PREFIX = "contact:";

/**
 * The message's own recipients, or [] when this user may not read them.
 *
 * The preview route is staff-gated but bulk messages are not: the
 * recipient list is `bulk.edit` data, so previewing against it must
 * clear the same bar the participants endpoint does. A surface
 * authorizes its own contexts precisely because only it knows this.
 */
async function messageRecipients({
  storage,
  params,
  req,
}: TemplateSurfaceContextRequest): Promise<
  Array<{ contactId: string; label: string }>
> {
  const messageId = typeof params.messageId === "string" ? params.messageId : "";
  if (!messageId) return [];
  const { checkAccessInline } = await import("../../../services/access-policy-evaluator");
  const access = await checkAccessInline(req, "bulk.edit", messageId);
  if (!access.granted) return [];

  const rows = await storage.bulkParticipants.listForMessageWithRelations(messageId);
  const seen = new Set<string>();
  const out: Array<{ contactId: string; label: string }> = [];
  for (const row of rows) {
    if (!row.contactId || seen.has(row.contactId)) continue;
    seen.add(row.contactId);
    const name =
      row.contactDisplayName ||
      [row.contactGiven, row.contactFamily].filter(Boolean).join(" ") ||
      row.contactId;
    out.push({
      contactId: row.contactId,
      label: row.workerSiriusId ? `${name} (#${row.workerSiriusId})` : name,
    });
    if (out.length >= RECIPIENT_LIMIT) break;
  }
  return out;
}

/**
 * Bulk message content. Real-data preview is restricted to the
 * message's OWN recipients — the people who will actually receive this
 * text — and never to an arbitrary contact the author names.
 */
registerTemplateSurface({
  id: "bulk-message",
  name: "Bulk message content",
  description:
    "One medium (email / SMS / postal / in-app) of a bulk message's tokenized content.",
  fields: mergeChannelFieldSpecs(BULK_CHANNEL_FIELDS),
  async resolve({ params, values }): Promise<TemplateSurfaceResolution> {
    const channel = typeof params.channel === "string" ? params.channel : "";
    const specs = BULK_CHANNEL_FIELDS[channel];
    if (!specs) {
      throw new TemplateSurfaceError(400, `Unknown bulk medium "${channel}"`);
    }

    // Every field of the medium is in play, blank ones included, so the
    // preview reflects what delivery does with an empty value.
    const templates: Record<string, string> = {};
    for (const spec of specs) {
      const value = values[spec.key];
      templates[spec.key] = typeof value === "string" ? value : "";
    }

    if (channel === "inapp") {
      // The in-app body is composed in a rich-text editor but stored and
      // delivered as plain text, so preview the flattened text.
      const { htmlToPlainText } = await import("../../../../shared/html-to-text");
      const html = values.bodyHtml;
      if (typeof html === "string") templates.body = htmlToPlainText(html);
    }

    return { templates };
  },

  async listPreviewContexts(
    ctx: TemplateSurfaceContextRequest,
  ): Promise<TemplateSurfacePreviewContext[]> {
    const recipients = await messageRecipients(ctx);
    return recipients.map((r) => ({
      id: `${CONTACT_PREFIX}${r.contactId}`,
      label: r.label,
      description: "Recipient of this message",
    }));
  },

  async resolvePreviewContext(
    id: string,
    ctx: TemplateSurfaceContextRequest,
  ): Promise<TemplateSurfaceResolvedContext | null> {
    if (!id.startsWith(CONTACT_PREFIX)) return null;
    const contactId = id.slice(CONTACT_PREFIX.length);
    // Re-list rather than trust the id: the offer IS the authorization,
    // so a contact who is no longer a recipient is no longer renderable.
    const recipients = await messageRecipients(ctx);
    if (!recipients.some((r) => r.contactId === contactId)) return null;
    const row = await ctx.storage.bulkTokens.getContactRow(contactId);
    if (!row) return null;
    // The recipient seeds the contact root AND is the render's
    // recipient, so worker/employer resolve off them as they do on
    // delivery.
    return { roots: [{ kind: "contact", row, table: contacts }], contactId };
  },
});

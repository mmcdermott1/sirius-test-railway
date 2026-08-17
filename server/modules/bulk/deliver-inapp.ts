import type { IStorage } from "../../storage";
import { sendInapp, type SendInappResult } from "../../services/comm/senders/inapp";
import type { DeliverContactResult } from "./deliver";
import { renderTokens, createTokenEvalContext } from "../../plugins/tokens";
import { applyFieldEligibility, shapeRenderedValue } from "../../plugins/template-surfaces/shape";
import { BULK_CHANNEL_FIELDS } from "./field-media";

export async function resolveUserId(storage: IStorage, contactId: string): Promise<string | null> {
  const contact = await storage.contacts.getContact(contactId);
  if (!contact?.email) return null;
  const user = await storage.users.getUserByEmail(contact.email);
  return user?.id || null;
}

/**
 * Shape one bulk in-app notification for delivery, field by field, with
 * the media each field declares — so the tokenized fields are rendered
 * and the literal link URL is sent exactly as stored. The template
 * studio previews through the same declarations and the same shaping
 * call, so an author sees what the recipient receives.
 */
export async function renderInappContentForDelivery(
  content: { title?: string | null; body?: string | null; linkUrl?: string | null; linkLabel?: string | null },
  ctx: Parameters<typeof renderTokens>[1],
): Promise<{ title: string; body: string; linkUrl?: string; linkLabel?: string }> {
  const shaped: Record<string, string> = {};
  for (const spec of BULK_CHANNEL_FIELDS.inapp) {
    const raw = (content as Record<string, string | null | undefined>)[spec.key] || "";
    const rendered =
      spec.media === "literal"
        ? raw
        : (await renderTokens(raw, ctx, { strictUnknown: true })).output;
    shaped[spec.key] = shapeRenderedValue(spec, rendered);
  }
  const { values } = applyFieldEligibility(BULK_CHANNEL_FIELDS.inapp, shaped);
  return {
    title: values.title,
    body: values.body,
    linkUrl: values.linkUrl || undefined,
    linkLabel: values.linkLabel || undefined,
  };
}

export async function deliverInapp(
  storage: IStorage,
  messageId: string,
  contactId: string,
  userId?: string,
  tagIds?: string[],
): Promise<DeliverContactResult> {
  const inappContent = await storage.bulkMessagesInapp.getByBulkId(messageId);
  if (!inappContent) {
    return { success: false, error: "No in-app content configured for this message", errorCode: "NO_CONTENT" };
  }
  const targetUserId = await resolveUserId(storage, contactId);
  if (!targetUserId) {
    return { success: false, error: "Contact does not have a linked user account (required for in-app messages)", errorCode: "NO_USER" };
  }
  const ctx = createTokenEvalContext(storage, contactId);
  const rendered = await renderInappContentForDelivery(inappContent, ctx);
  const result: SendInappResult = await sendInapp({
    contactId,
    userId: targetUserId,
    title: rendered.title,
    body: rendered.body,
    linkUrl: rendered.linkUrl,
    linkLabel: rendered.linkLabel,
    initiatedBy: userId || "bulk-test",
    tagIds,
  });
  return {
    success: result.success,
    commId: result.comm?.id,
    comm: result.comm,
    error: result.error,
    errorCode: result.errorCode,
    resolvedAddress: `user:${targetUserId}`,
  };
}

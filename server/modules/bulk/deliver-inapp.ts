import type { IStorage } from "../../storage";
import { sendInapp, type SendInappResult } from "../../services/comm/senders/inapp";
import type { DeliverContactResult } from "./deliver";
import { renderTokens, createTokenEvalContext } from "../../plugins/tokens";

export async function resolveUserId(storage: IStorage, contactId: string): Promise<string | null> {
  const contact = await storage.contacts.getContact(contactId);
  if (!contact?.email) return null;
  const user = await storage.users.getUserByEmail(contact.email);
  return user?.id || null;
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
  const renderedTitle = (await renderTokens(inappContent.title || "", ctx, { strictUnknown: true })).output;
  const renderedBody = (await renderTokens(inappContent.body || "", ctx, { strictUnknown: true })).output;
  const renderedLinkLabel = inappContent.linkLabel
    ? (await renderTokens(inappContent.linkLabel, ctx, { strictUnknown: true })).output
    : undefined;
  const result: SendInappResult = await sendInapp({
    contactId,
    userId: targetUserId,
    title: renderedTitle,
    body: renderedBody,
    linkUrl: inappContent.linkUrl || undefined,
    linkLabel: renderedLinkLabel,
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

import type { IStorage } from "../../storage";
import { sendEmail, type SendEmailResult } from "../../services/comm/senders/email";
import type { DeliverContactResult } from "./deliver";
import { renderTokens, createTokenEvalContext } from "../../plugins/tokens";
import { shapeRenderedValue } from "../../plugins/template-surfaces/shape";
import { BULK_CHANNEL_FIELDS } from "./field-media";

const [SUBJECT_SPEC, BODY_HTML_SPEC] = BULK_CHANNEL_FIELDS.email;

/**
 * Shape one bulk email body for delivery: render its tokens with HTML
 * escaping (so a substituted value can never inject markup), then apply
 * the declared shaping for the field — the same call the template
 * studio's preview makes, so what an author previews is what the
 * recipient receives.
 */
export async function renderEmailBodyHtmlForDelivery(
  bodyHtml: string,
  ctx: Parameters<typeof renderTokens>[1],
): Promise<string> {
  if (!bodyHtml) return "";
  const rendered = (
    await renderTokens(bodyHtml, ctx, { escapeHtml: true, strictUnknown: true })
  ).output;
  return shapeRenderedValue(BODY_HTML_SPEC, rendered);
}

/** Subject shaping for delivery (blank falls back, as declared). */
export async function renderEmailSubjectForDelivery(
  subject: string,
  ctx: Parameters<typeof renderTokens>[1],
): Promise<string> {
  const rendered = (await renderTokens(subject || "", ctx, { strictUnknown: true })).output;
  return shapeRenderedValue(SUBJECT_SPEC, rendered);
}

export async function resolveEmailAddress(storage: IStorage, contactId: string): Promise<{ address: string; name?: string } | null> {
  const contact = await storage.contacts.getContact(contactId);
  if (!contact?.email) return null;
  return { address: contact.email, name: contact.displayName || undefined };
}

export async function deliverEmail(
  storage: IStorage,
  messageId: string,
  contactId: string,
  userId?: string,
  tagIds?: string[],
  offline?: boolean,
): Promise<DeliverContactResult> {
  const emailContent = await storage.bulkMessagesEmail.getByBulkId(messageId);
  if (!emailContent) {
    return { success: false, error: "No email content configured for this message", errorCode: "NO_CONTENT" };
  }
  const resolved = await resolveEmailAddress(storage, contactId);
  if (!resolved) {
    return { success: false, error: "Contact has no email address", errorCode: "NO_ADDRESS" };
  }
  const ctx = createTokenEvalContext(storage, contactId);
  const renderedSubject = await renderEmailSubjectForDelivery(emailContent.subject || "", ctx);
  const renderedText = emailContent.bodyText
    ? (await renderTokens(emailContent.bodyText, ctx, { strictUnknown: true })).output
    : undefined;
  const renderedHtml = emailContent.bodyHtml
    ? await renderEmailBodyHtmlForDelivery(emailContent.bodyHtml, ctx)
    : undefined;
  const result: SendEmailResult = await sendEmail({
    contactId,
    toEmail: resolved.address,
    toName: resolved.name,
    subject: renderedSubject,
    bodyText: renderedText,
    bodyHtml: renderedHtml,
    fromEmail: emailContent.fromAddress || undefined,
    fromName: emailContent.fromName || undefined,
    replyTo: emailContent.replyTo || undefined,
    userId,
    tagIds,
    sendOffline: offline,
  });
  return {
    success: result.success,
    commId: result.comm?.id,
    comm: result.comm,
    error: result.error,
    errorCode: result.errorCode,
    resolvedAddress: resolved.address,
  };
}

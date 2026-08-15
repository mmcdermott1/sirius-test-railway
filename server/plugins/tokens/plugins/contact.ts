import { registerTokenPlugin } from "../registry";
import { memo, type ContactEntity, type WorkerEntity, type TokenEvalContext } from "../types";
import { fmtDateShort } from "../php-date";

async function loadContact(
  ctx: TokenEvalContext,
  contactId: string,
): Promise<ContactEntity["contact"] | null> {
  return memo(ctx, `contact:${contactId}`, async () => {
    const row = await ctx.storage.bulkTokens.getContactWithGender(contactId);
    return row ?? null;
  });
}

export { loadContact };

/** Root: {{contact...}} — the recipient's contact record. */
registerTokenPlugin({
  metadata: {
    id: "token.contact",
    name: "Contact",
    description: "The recipient's contact record",
    segmentName: "contact",
    inputTypes: ["root"],
    outputType: "contact",
  },
  async resolve(_entity, _args, ctx) {
    if (!ctx.contactId) return null;
    const contact = await loadContact(ctx, ctx.contactId);
    if (!contact) return null;
    const entity: ContactEntity = { kind: "contact", contact };
    return entity;
  },
});

type NameEntity = ContactEntity | WorkerEntity;

function contactOf(entity: unknown): ContactEntity["contact"] | null {
  const e = entity as NameEntity | null;
  if (!e) return null;
  return e.contact ?? null;
}

function fullName(c: ContactEntity["contact"] | null): string {
  if (!c) return "";
  return (c.displayName || `${c.given || ""} ${c.family || ""}`.trim() || "").trim();
}

/**
 * Name/identity leaves work on both contact and worker entities so
 * legacy chains like worker.firstName keep resolving (via the
 * worker's contact record).
 */
registerTokenPlugin({
  metadata: {
    id: "token.leaf.firstName",
    name: "First name",
    shortLabel: "first name",
    description: "Given name on the contact record",
    segmentName: "firstName",
    inputTypes: ["contact", "worker"],
    outputType: "value",
    defaultValue: "Friend",
    example: "Jamie",
  },
  async resolve(entity) {
    return contactOf(entity)?.given ?? null;
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.lastName",
    name: "Last name",
    shortLabel: "last name",
    description: "Family name on the contact record",
    segmentName: "lastName",
    inputTypes: ["contact", "worker"],
    outputType: "value",
    example: "Rivera",
  },
  async resolve(entity) {
    return contactOf(entity)?.family ?? null;
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.fullName",
    name: "Full name",
    shortLabel: "full name",
    description: "Display name on the contact record",
    segmentName: "fullName",
    inputTypes: ["contact", "worker"],
    outputType: "value",
    defaultValue: "Member",
    example: "Jamie Rivera",
  },
  async resolve(entity) {
    return fullName(contactOf(entity)) || null;
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.email",
    name: "Email",
    shortLabel: "email",
    description: "Primary email on the contact record",
    segmentName: "email",
    inputTypes: ["contact", "worker"],
    outputType: "value",
    example: "jamie@example.com",
  },
  async resolve(entity) {
    return contactOf(entity)?.email ?? null;
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.dob",
    name: "Date of birth",
    shortLabel: "date of birth",
    description: "Date of birth from the contact record",
    segmentName: "dob",
    inputTypes: ["contact", "worker"],
    outputType: "value",
    example: "Apr 17, 1987",
  },
  async resolve(entity) {
    return fmtDateShort(contactOf(entity)?.birthDate) || null;
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.gender",
    name: "Gender",
    shortLabel: "gender",
    description: "Gender label from the contact record",
    segmentName: "gender",
    inputTypes: ["contact", "worker"],
    outputType: "value",
    example: "Female",
  },
  async resolve(entity) {
    return contactOf(entity)?.genderName ?? null;
  },
});

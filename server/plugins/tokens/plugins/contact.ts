import { contacts } from "@shared/schema";
import { registerTokenPlugin } from "../registry";
import { memo, tokenEntityOf, type TokenEntity, type TokenEvalContext } from "../types";

export async function loadContactEntity(
  ctx: TokenEvalContext,
  contactId: string,
): Promise<TokenEntity | null> {
  const row = await memo(ctx, `contact-row:${contactId}`, async () => {
    return (await ctx.storage.bulkTokens.getContactRow(contactId)) ?? null;
  });
  if (!row) return null;
  return { kind: "contact", row, table: contacts };
}

/** Root: {{contact...}} — the recipient's full contact record. */
registerTokenPlugin({
  metadata: {
    id: "token.contact",
    name: "Contact",
    description: "The recipient's contact record",
    segmentName: "contact",
    inputTypes: ["root"],
    outputType: "contact",
    entityTable: contacts,
    defaultLeaf: "display_name",
  },
  async resolve(_entity, _args, ctx) {
    if (!ctx.contactId) return null;
    return loadContactEntity(ctx, ctx.contactId);
  },
});

/** {{worker.contact...}} — hop from a worker to its contact record. */
registerTokenPlugin({
  metadata: {
    id: "token.worker.contact",
    name: "Worker contact",
    description: "The contact record behind a worker",
    segmentName: "contact",
    inputTypes: ["worker"],
    outputType: "contact",
    entityTable: contacts,
    hiddenFromCatalog: true,
    defaultLeaf: "display_name",
  },
  async resolve(entity, _args, ctx) {
    const w = tokenEntityOf(entity, "worker");
    const contactId = w?.row.contactId;
    if (typeof contactId !== "string") return null;
    return loadContactEntity(ctx, contactId);
  },
});

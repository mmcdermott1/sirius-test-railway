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
    recipientRooted: true,
    previewEntities: {
      async search(query) {
        const { storage } = await import("../../../storage");
        const rows = await storage.contacts.searchWithPrimaryContactInfo(query, 20);
        return rows.map((r) => {
          const name = r.displayName || r.email || r.id;
          return { id: r.id, label: r.email ? `${name} — ${r.email}` : name };
        });
      },
      async load(id) {
        const { storage } = await import("../../../storage");
        const row = await storage.bulkTokens.getContactRow(id);
        if (!row) return null;
        return { kind: "contact", row, table: contacts };
      },
    },
  },
  async resolve(_entity, _args, ctx) {
    // A seeded contact wins; otherwise the root means "the recipient".
    const seeded = ctx.roots.contact;
    if (seeded) return seeded;
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

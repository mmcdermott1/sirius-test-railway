import { contactPostal } from "@shared/schema";
import { registerTokenPlugin } from "../registry";
import { memo, tokenEntityOf, type TokenEntity } from "../types";

/**
 * {{contact.address(primary="true").field(name=…)}} — the recipient's
 * postal address. primary="true" (default) requires the primary active
 * address; primary="false" accepts any active address.
 *
 * All real columns of contact_postal are addressable by their schema
 * name (snake_case or camelCase). Derived extras:
 *   zip  — alias for postal_code
 *   full — one-line composed address (street, city, state, postal_code)
 */
registerTokenPlugin({
  metadata: {
    id: "token.address",
    name: "Postal address",
    description: "The contact's active postal address",
    segmentName: "address",
    inputTypes: ["contact", "worker"],
    outputType: "address",
    entityTable: contactPostal,
    entityFields: ["zip", "full"],
    args: {
      primary: {
        default: "true",
        description:
          'When "true", only the primary active address; otherwise any active address',
      },
    },
  },
  async resolve(entity, args, ctx) {
    const e = tokenEntityOf(entity, "contact") ?? tokenEntityOf(entity, "worker");
    if (!e) return null;
    const contactId =
      e.kind === "contact" ? e.row.id : e.row.contactId;
    if (typeof contactId !== "string") return null;
    const addresses = await memo(ctx, `addresses:${contactId}`, () =>
      ctx.storage.contacts.addresses.getContactPostalByContact(contactId),
    );
    const primaryOnly = args.primary !== "false";
    const primary = addresses.find((a) => a.isPrimary && a.isActive);
    const addr = primaryOnly ? primary : primary || addresses.find((a) => a.isActive);
    if (!addr) return null;
    const full =
      [addr.street, addr.city, addr.state, addr.postalCode]
        .filter(Boolean)
        .join(", ") || null;
    const out: TokenEntity = {
      kind: "address",
      row: { ...addr, zip: addr.postalCode, full },
      table: contactPostal,
    };
    return out;
  },
});

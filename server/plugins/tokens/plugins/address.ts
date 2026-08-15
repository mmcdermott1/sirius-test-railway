import { registerTokenPlugin } from "../registry";
import { memo, tokenEntityOf, type TokenEntity } from "../types";

const ADDRESS_FIELDS = [
  "street",
  "city",
  "state",
  "postal_code",
  "zip",
  "country",
  "full",
];

/**
 * {{contact.address(primary="true").field(name="street")}} — the
 * recipient's postal address. primary="true" (default) requires the
 * primary active address; primary="false" accepts any active address.
 * Fields: street, city, state, postal_code (alias zip), country, full.
 */
registerTokenPlugin({
  metadata: {
    id: "token.address",
    name: "Postal address",
    description: "The contact's active postal address",
    segmentName: "address",
    inputTypes: ["contact", "worker"],
    outputType: "address",
    entityFields: ADDRESS_FIELDS,
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
    const out: TokenEntity = {
      kind: "address",
      row: {
        street: addr.street,
        city: addr.city,
        state: addr.state,
        postalCode: addr.postalCode,
        zip: addr.postalCode,
        country: addr.country ?? null,
        full:
          [addr.street, addr.city, addr.state, addr.postalCode]
            .filter(Boolean)
            .join(", ") || null,
      },
    };
    return out;
  },
});

import { registerTokenPlugin } from "../registry";
import {
  memo,
  type AddressEntity,
  type ContactEntity,
  type WorkerEntity,
} from "../types";

function contactIdOf(entity: unknown): string | null {
  const e = entity as ContactEntity | WorkerEntity | null;
  if (!e) return null;
  if (e.kind === "contact") return e.contact.id;
  if (e.kind === "worker") return e.worker.contactId;
  return null;
}

/**
 * {{contact.address(primary="true").field(name="street")}} — the
 * recipient's postal address. primary="true" (default) requires the
 * primary active address; primary="false" accepts any active address.
 */
registerTokenPlugin({
  metadata: {
    id: "token.address",
    name: "Postal address",
    description: "The contact's active postal address",
    segmentName: "address",
    inputTypes: ["contact", "worker"],
    outputType: "address",
    args: {
      primary: {
        default: "true",
        description:
          'When "true", only the primary active address; otherwise any active address',
      },
    },
  },
  async resolve(entity, args, ctx) {
    const contactId = contactIdOf(entity);
    if (!contactId) return null;
    const addresses = await memo(ctx, `addresses:${contactId}`, () =>
      ctx.storage.contacts.addresses.getContactPostalByContact(contactId),
    );
    const primaryOnly = args.primary !== "false";
    const primary = addresses.find((a) => a.isPrimary && a.isActive);
    const addr = primaryOnly ? primary : primary || addresses.find((a) => a.isActive);
    if (!addr) return null;
    const result: AddressEntity = {
      kind: "address",
      address: {
        street: addr.street,
        city: addr.city,
        state: addr.state,
        postalCode: addr.postalCode,
        country: addr.country ?? null,
      },
    };
    return result;
  },
});

const ADDRESS_FIELDS: Record<string, (a: AddressEntity["address"]) => string | null> = {
  street: (a) => a.street,
  city: (a) => a.city,
  state: (a) => a.state,
  postalCode: (a) => a.postalCode,
  zip: (a) => a.postalCode,
  country: (a) => a.country,
  full: (a) =>
    [a.street, a.city, a.state, a.postalCode].filter(Boolean).join(", ") || null,
};

registerTokenPlugin({
  metadata: {
    id: "token.leaf.addressField",
    name: "Address field",
    shortLabel: "address field",
    description: "One field of the postal address",
    segmentName: "field",
    inputTypes: ["address"],
    outputType: "value",
    args: {
      name: {
        required: true,
        description: `Field name: ${Object.keys(ADDRESS_FIELDS).join(", ")}`,
      },
    },
    example: "123 Main St",
    catalogVariants: [
      { args: { name: "street" }, label: "address street", example: "123 Main St" },
      { args: { name: "city" }, label: "address city", example: "Springfield" },
      { args: { name: "state" }, label: "address state", example: "MA" },
      { args: { name: "postalCode" }, label: "address postal code", example: "01101" },
      {
        args: { name: "full" },
        label: "address (full)",
        example: "123 Main St, Springfield, MA, 01101",
      },
    ],
  },
  async resolve(entity, args) {
    const e = entity as AddressEntity | null;
    if (!e || e.kind !== "address") return null;
    const getter = ADDRESS_FIELDS[args.name];
    if (!getter) return null;
    return getter(e.address);
  },
});

import { getFieldCatalog } from "./evaluate";
import { resolveRowKey } from "./plugins/field";
import type { TokenEntity } from "./types";

/**
 * COVERAGE: does a seeded record actually carry every field the editor
 * offers for its kind?
 *
 * The field catalog for an entity kind is derived from the kind's table
 * columns plus whatever extras a plugin declares — it describes what a
 * template author is ALLOWED to write. A surface that seeds a record
 * hand-built from an event payload can easily satisfy the validator and
 * still be missing most of those keys at delivery time: the offered
 * token passes save-time validation, renders a real value in a preview
 * (previews seed real rows), and comes out BLANK in the sent message.
 *
 * This is the check that catches that gap: give it the record a surface
 * actually seeded and it names the advertised fields the record cannot
 * supply. An open catalog (no closed field list) is not checkable and
 * reports nothing.
 */
export function missingCatalogFields(entity: TokenEntity): string[] {
  const entry = getFieldCatalog()[entity.kind];
  if (!entry || entry.open) return [];
  return entry.names.filter((name) => resolveRowKey(entity, name) === null);
}

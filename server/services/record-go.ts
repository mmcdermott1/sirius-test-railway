import { entityMetadataStorage, type EntityMetadataView } from "../storage/system/entity-metadata";
import { metadataRecordHref } from "../storage/entity-metadata-record-tables";
import { escapeHtml } from "@shared/utils/html";

export type RecordGoIdentifier =
  | { kind: "uuid"; value: string }
  | { kind: "sequence"; value: number; revision?: number };

export type RecordGoResolution =
  | { kind: "resolved"; metadata: EntityMetadataView; href: string }
  | { kind: "not_found"; reason: "unknown" | "no_page" };

const SEQUENCE_PART = /^\d+(?:\.\d+)*$/;
const UUID_PART = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * Parse a copied metadata id, record id, raw sequence, or grouped badge.
 * The revision is intentionally advisory: the current metadata row owns the
 * destination, even when copied revision text is stale.
 */
export function parseRecordGoIdentifier(input: string): RecordGoIdentifier | null {
  const value = input.trim();
  if (UUID_PART.test(value)) return { kind: "uuid", value };

  const [sequenceText, revisionText, ...extra] = value.split("::");
  if (extra.length > 0 || !SEQUENCE_PART.test(sequenceText)) return null;

  const sequenceDigits = sequenceText.replaceAll(".", "");
  const sequence = Number(sequenceDigits);
  if (!Number.isSafeInteger(sequence) || sequence <= 0) return null;

  if (revisionText === undefined) {
    return { kind: "sequence", value: sequence };
  }
  if (!SEQUENCE_PART.test(revisionText)) return null;

  const revision = Number(revisionText.replaceAll(".", ""));
  if (!Number.isSafeInteger(revision) || revision <= 0) return null;
  return { kind: "sequence", value: sequence, revision };
}

export async function resolveRecordGoIdentifier(
  input: string,
): Promise<RecordGoResolution> {
  const parsed = parseRecordGoIdentifier(input);
  if (!parsed) return { kind: "not_found", reason: "unknown" };

  const metadata =
    parsed.kind === "uuid"
      ? (await entityMetadataStorage.getByMetadataId(parsed.value)) ??
        (await entityMetadataStorage.get(parsed.value))
      : await entityMetadataStorage.getBySequence(parsed.value);

  if (!metadata) return { kind: "not_found", reason: "unknown" };

  const href = metadataRecordHref(metadata.tableName, metadata.entityId);
  if (!href) return { kind: "not_found", reason: "no_page" };
  return { kind: "resolved", metadata, href };
}
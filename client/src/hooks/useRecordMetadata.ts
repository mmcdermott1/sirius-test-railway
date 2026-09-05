import { useQuery } from "@tanstack/react-query";
import type { RecordMetadata } from "@/components/shared/RecordHistoryDialog";

const RECORD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Whether this is a record's own id, and therefore something to ask about. */
export function isRecordId(entityId: string | null | undefined): entityId is string {
  return !!entityId && RECORD_ID_PATTERN.test(entityId);
}

/**
 * Reading one record's history: when it was created, when it last changed, and
 * who did each.
 *
 * The one place the client asks. A record's creation date is provenance — no
 * table keeps its own — so a screen that shows when something was made reads
 * it from here, and reads exactly what the record-history badge shows, because
 * it is the same query.
 *
 * A record with nothing recorded answers `null`, which is an ordinary answer
 * and not an error: every record that predates this bookkeeping reads that way
 * until something touches it, and so does a record created a moment ago, whose
 * provenance is written just after its own insert commits.
 */
export function useRecordMetadata(entityId: string | null | undefined) {
  const enabled = isRecordId(entityId);

  const query = useQuery<{ metadata: RecordMetadata | null }>({
    queryKey: ["/api/entity-metadata", entityId],
    enabled,
    retry: false,
    // What this shows changes underneath us constantly: a record's history is
    // written by whatever mutation caused it, moments after that mutation
    // answered, and by other people's mutations besides. Nothing invalidates
    // this query, so it must never be treated as settled — the client's
    // default is to cache a query forever, which here would pin a record's
    // history to whatever was true when the page first opened. A record
    // created seconds ago is the sharpest case: its first read can beat the
    // after-commit write and see nothing at all.
    staleTime: 0,
  });

  return {
    ...query,
    /** Whether there was anything to ask about at all. */
    enabled,
    metadata: query.data?.metadata ?? null,
  };
}

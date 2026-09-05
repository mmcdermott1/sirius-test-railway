import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { formatRecordSequence } from "@shared/utils/record-sequence";
import {
  RecordHistoryDialog,
  type RecordHistoryState,
  type RecordMetadata,
} from "./RecordHistoryDialog";

const RECORD_ID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

interface RecordMetadataBadgeProps {
  /** The record's own id. Anything else renders nothing. */
  entityId: string | null | undefined;
}

/**
 * A record's history, in the corner of the page that shows the record.
 *
 * The badge reads the record's sequence number — the one permanent name the
 * system has for it — and opens what little else it knows: when the record was
 * created, when it last changed, and when something hanging off it last
 * changed, each with the person responsible.
 *
 * The dialog itself is {@link RecordHistoryDialog}, shared with the
 * administrator's list of every record's history, so the two cannot drift into
 * showing the same facts differently. What this component owns is the badge
 * and the lookup behind it.
 *
 * None of it is editable, here or anywhere. The system writes a record's
 * history as it writes the record; there is no form behind this dialog and no
 * endpoint to change what it shows.
 *
 * Records that predate this bookkeeping have nothing recorded and show a muted
 * placeholder until something touches them. That is the ordinary case today,
 * not an error.
 */
export function RecordMetadataBadge({ entityId }: RecordMetadataBadgeProps) {
  const [open, setOpen] = useState(false);
  const isRecordId = !!entityId && RECORD_ID_PATTERN.test(entityId);

  const { data, isFetching, isError, refetch } = useQuery<{ metadata: RecordMetadata | null }>({
    queryKey: ["/api/entity-metadata", entityId],
    enabled: isRecordId,
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

  function handleOpenChange(next: boolean) {
    setOpen(next);
    // Read again every time someone actually looks. This is the moment the
    // answer has to be current, and the only moment we know it is wanted.
    if (next) void refetch();
  }

  // A page whose record is still loading, or whose id is not a record id at
  // all, has nothing to ask about.
  if (!isRecordId) return null;

  const metadata = data?.metadata ?? null;
  const label = metadata ? formatRecordSequence(metadata.seq) : "—";

  const state: RecordHistoryState =
    isFetching && !data
      ? { status: "loading" }
      : isError
        ? { status: "error" }
        : { status: "ready", metadata };

  return (
    <>
      <Button
        variant="ghost"
        size="sm"
        className={`gap-1.5 font-mono text-xs ${metadata ? "text-muted-foreground" : "text-muted-foreground/60"}`}
        onClick={() => handleOpenChange(true)}
        title="Record history"
        aria-label="Record history"
        data-testid="button-record-metadata"
      >
        <History className="h-3.5 w-3.5" />
        {label}
      </Button>

      <RecordHistoryDialog open={open} onOpenChange={handleOpenChange} state={state} />
    </>
  );
}

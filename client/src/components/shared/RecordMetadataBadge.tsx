import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format } from "@/lib/date-format";
import { formatRecordSequence } from "@shared/utils/record-sequence";

/** One date/person pair as the lookup returns it. */
interface RecordMetadataStamp {
  date: string | null;
  personName: string | null;
}

interface RecordMetadata {
  seq: number;
  tableName: string;
  entityId: string;
  created: RecordMetadataStamp;
  modified: RecordMetadataStamp;
  subrecordModified: RecordMetadataStamp;
}

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

      <Dialog open={open} onOpenChange={handleOpenChange}>
        {/*
          There is no description to give: the dialog is its own explanation.
          The dialog primitive warns about a missing description unless the
          caller says so on purpose, which is what the undefined below is.
        */}
        <DialogContent
          className="max-w-md"
          aria-describedby={undefined}
          data-testid="dialog-record-metadata"
        >
          <DialogHeader>
            <DialogTitle>Record history</DialogTitle>
          </DialogHeader>

          {isFetching && !data ? (
            <p className="text-sm text-muted-foreground" data-testid="text-record-metadata-loading">
              Loading…
            </p>
          ) : isError ? (
            <p className="text-sm text-muted-foreground" data-testid="text-record-metadata-error">
              This record's history could not be read.
            </p>
          ) : !metadata ? (
            <p className="text-sm text-muted-foreground" data-testid="text-record-metadata-empty">
              No data
            </p>
          ) : (
            <dl className="space-y-3 text-sm">
              <StampRow label="Created" stamp={metadata.created} testId="created" />
              <StampRow label="Last modified" stamp={metadata.modified} testId="modified" />
              <StampRow
                label="Sub-record modified"
                stamp={metadata.subrecordModified}
                testId="subrecord"
              />
              <div className="flex items-baseline justify-between gap-4 pt-2 border-t border-border">
                <dt className="text-muted-foreground">Sequence</dt>
                <dd className="font-mono" data-testid="text-record-metadata-seq">
                  {formatRecordSequence(metadata.seq)}
                </dd>
              </div>
            </dl>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}

function StampRow({
  label,
  stamp,
  testId,
}: {
  label: string;
  stamp: RecordMetadataStamp;
  testId: string;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4">
      <dt className="text-muted-foreground shrink-0">{label}</dt>
      <dd className="text-right" data-testid={`text-record-metadata-${testId}`}>
        {stamp.date ? (
          <>
            <span>{format(new Date(stamp.date), "MMM d, yyyy h:mm a")}</span>
            <span className="block text-muted-foreground">
              {stamp.personName ?? "person not recorded"}
            </span>
          </>
        ) : (
          <span className="text-muted-foreground">Never</span>
        )}
      </dd>
    </div>
  );
}

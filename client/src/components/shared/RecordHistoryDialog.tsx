import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { format } from "@/lib/date-format";
import { formatRecordSequence } from "@shared/utils/record-sequence";

/** One date/person pair as a record's history reports it. */
export interface RecordMetadataStamp {
  date: string | null;
  personName: string | null;
}

/** What the system knows about how one record came to be as it is. */
export interface RecordMetadata {
  seq: number;
  tableName: string;
  entityId: string;
  created: RecordMetadataStamp;
  modified: RecordMetadataStamp;
  subrecordModified: RecordMetadataStamp;
}

/**
 * What the caller has to show. A record with no history is `ready` with
 * nothing in it, which is an answer — every record that predates this
 * bookkeeping reads that way — and not the same as not having asked yet.
 */
export type RecordHistoryState =
  | { status: "loading" }
  | { status: "error" }
  | { status: "ready"; metadata: RecordMetadata | null };

interface RecordHistoryDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  state: RecordHistoryState;
}

/**
 * A record's history, in a dialog.
 *
 * Two places open this: the badge in the corner of the record's own page, and
 * the administrator's list of every provenance row in the system. They arrive
 * at it differently — the badge asks the server for one record, the list
 * already holds the row it is showing — so this component is handed the
 * answer rather than fetching one. That is what keeps the two the same
 * dialog: the only thing they can differ in is where the facts came from.
 *
 * Nothing here is editable, in either caller. The system writes a record's
 * history as it writes the record; there is no form behind this and no
 * endpoint to change what it shows.
 */
export function RecordHistoryDialog({
  open,
  onOpenChange,
  state,
}: RecordHistoryDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
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

        {state.status === "loading" ? (
          <p className="text-sm text-muted-foreground" data-testid="text-record-metadata-loading">
            Loading…
          </p>
        ) : state.status === "error" ? (
          <p className="text-sm text-muted-foreground" data-testid="text-record-metadata-error">
            This record's history could not be read.
          </p>
        ) : !state.metadata ? (
          <p className="text-sm text-muted-foreground" data-testid="text-record-metadata-empty">
            No data
          </p>
        ) : (
          <dl className="space-y-3 text-sm">
            <StampRow label="Created" stamp={state.metadata.created} testId="created" />
            <StampRow label="Last modified" stamp={state.metadata.modified} testId="modified" />
            <StampRow
              label="Sub-record modified"
              stamp={state.metadata.subrecordModified}
              testId="subrecord"
            />
            <div className="flex items-baseline justify-between gap-4 pt-2 border-t border-border">
              <dt className="text-muted-foreground">Sequence</dt>
              <dd className="font-mono" data-testid="text-record-metadata-seq">
                {formatRecordSequence(state.metadata.seq)}
              </dd>
            </div>
          </dl>
        )}
      </DialogContent>
    </Dialog>
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

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { usePageTitle } from "@/contexts/PageTitleContext";
import { RecordHistoryLayout } from "@/components/layouts/RecordHistoryLayout";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";

/**
 * Filling in record history for records that predate the bookkeeping.
 *
 * What a filled-in row says is deliberately thin: the record was first seen at
 * the moment the button was pressed, by nobody. The system cannot know when a
 * pre-existing record was created or who created it, and inventing a plausible
 * answer would be worse than admitting to the sighting — the same thing it
 * already does for any record it meets mid-life.
 *
 * A run writes at most a batch and never overwrites an existing row, so the
 * button can be pressed as often as it takes. A run that fails partway keeps
 * everything it had already written.
 */

/** Kept in step with the server's own cap on one run. */
const BATCH_LIMIT = 1000;

interface TableChoice {
  tableName: string;
  label: string;
}

type MissingCount =
  | { tableName: string; countable: true; missing: number }
  | { tableName: string; countable: false; reason: string };

interface BackfillResult {
  tableName: string;
  written: number;
  alreadyPresent: number;
  skipped: number;
  missing: number;
}

export default function MetadataBackfillPage() {
  usePageTitle("Fill In Record History");

  const { data, isLoading, isError } = useQuery<{ tables: TableChoice[] }>({
    queryKey: ["/api/admin/entity-metadata/tables"],
  });

  const tables = data?.tables ?? [];

  return (
    <RecordHistoryLayout activeTab="record-metadata-backfill">
      <div className="space-y-2 text-sm text-muted-foreground">
        <p>
          Records created before the system began keeping history have none. Filling it in records
          only that the record was seen now, by nobody — the system cannot know when it was really
          created or who created it, and will not guess.
        </p>
        <p>
          Each run writes up to {BATCH_LIMIT.toLocaleString()} rows for one kind of record and never
          changes a history that already exists. Run it as many times as it takes.
        </p>
      </div>

      <Card>
        <CardContent className="pt-6">
          {isLoading ? (
            <p className="text-sm text-muted-foreground" data-testid="text-tables-loading">
              Loading…
            </p>
          ) : isError ? (
            <p className="text-sm text-muted-foreground" data-testid="text-tables-error">
              The list of record kinds could not be read.
            </p>
          ) : (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Kind of record</TableHead>
                    <TableHead className="w-64">Without history</TableHead>
                    <TableHead className="w-40" />
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {tables.map((table) => (
                    <TableRowForTable key={table.tableName} table={table} />
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>
    </RecordHistoryLayout>
  );
}

/**
 * One kind of record, with its own count.
 *
 * Counted per row rather than for the whole page at once: each count is a scan
 * of that kind's table, and asking for all of them in one request would make
 * the page wait on the slowest. A kind that cannot be counted says why in its
 * own row instead of being left out of the list.
 */
function TableRowForTable({ table }: { table: TableChoice }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const countKey = `/api/admin/entity-metadata/tables/${table.tableName}/missing`;

  const { data: count, isLoading, isError } = useQuery<MissingCount>({
    queryKey: [countKey],
  });

  const backfill = useMutation<BackfillResult>({
    mutationFn: async () => {
      const response = await apiRequest("POST", "/api/admin/entity-metadata/backfill", {
        tableName: table.tableName,
        limit: BATCH_LIMIT,
      });
      return response.json();
    },
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: [countKey] });
      toast({
        title: `${table.label}: ${result.written.toLocaleString()} filled in`,
        description:
          result.missing > 0
            ? `${result.missing.toLocaleString()} still without history. Run again to continue.`
            : "Every record of this kind now has a history.",
      });
    },
    onError: (error: Error) => {
      // A failed run still kept whatever it wrote, so the count is refreshed
      // either way and the message says so.
      queryClient.invalidateQueries({ queryKey: [countKey] });
      toast({
        title: `${table.label}: could not finish`,
        description: `${error.message} Anything already written was kept — running again continues from there.`,
        variant: "destructive",
      });
    },
  });

  const countable = count?.countable === true;
  const missing = countable ? count.missing : 0;

  return (
    <TableRow data-testid={`row-backfill-${table.tableName}`}>
      <TableCell>
        <div>{table.label}</div>
        <div className="font-mono text-xs text-muted-foreground">{table.tableName}</div>
      </TableCell>
      <TableCell data-testid={`text-missing-${table.tableName}`}>
        {isLoading ? (
          <span className="text-muted-foreground">Counting…</span>
        ) : isError ? (
          <span className="text-muted-foreground">Could not be counted</span>
        ) : count && !count.countable ? (
          <span className="text-muted-foreground">Unavailable — {count.reason}</span>
        ) : missing === 0 ? (
          <span className="text-muted-foreground">None</span>
        ) : (
          missing.toLocaleString()
        )}
      </TableCell>
      <TableCell className="text-right">
        {countable && missing > 0 && (
          <Button
            size="sm"
            variant="outline"
            disabled={backfill.isPending}
            onClick={() => backfill.mutate()}
            data-testid={`button-backfill-${table.tableName}`}
          >
            {backfill.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Fill in {Math.min(missing, BATCH_LIMIT).toLocaleString()}
          </Button>
        )}
      </TableCell>
    </TableRow>
  );
}

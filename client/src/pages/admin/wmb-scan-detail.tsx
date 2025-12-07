import { useQuery } from "@tanstack/react-query";
import { useParams, Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Progress } from "@/components/ui/progress";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { 
  ArrowLeft, 
  Download, 
  Calendar,
  AlertCircle,
  CheckCircle2,
  Clock,
  XCircle,
  Loader2,
  User,
  TrendingUp,
  TrendingDown,
  Minus
} from "lucide-react";
import { format } from "date-fns";

interface MonthStatus {
  id: string;
  month: number;
  year: number;
  status: string;
  totalQueued: number;
  processedSuccess: number;
  processedFailed: number;
  benefitsStarted: number;
  benefitsContinued: number;
  benefitsTerminated: number;
  queuedAt: string;
  startedAt: string | null;
  completedAt: string | null;
  lastError: string | null;
}

interface QueueEntry {
  id: string;
  workerId: string;
  status: string;
  triggerSource: string;
  attempts: number;
  completedAt: string | null;
  lastError: string | null;
  resultSummary: any;
  workerSiriusId: number | null;
  workerDisplayName: string | null;
}

interface ScanDetailResponse {
  status: MonthStatus;
  queueEntries: QueueEntry[];
}

function StatusBadge({ status }: { status: string }) {
  const config: Record<string, { variant: "default" | "secondary" | "outline" | "destructive"; label: string }> = {
    queued: { variant: "secondary", label: "Queued" },
    running: { variant: "default", label: "Running" },
    completed: { variant: "outline", label: "Completed" },
    failed: { variant: "destructive", label: "Failed" },
    stale: { variant: "secondary", label: "Stale" },
    pending: { variant: "secondary", label: "Pending" },
    processing: { variant: "default", label: "Processing" },
    success: { variant: "outline", label: "Success" },
    invalidated: { variant: "secondary", label: "Invalidated" },
    skipped: { variant: "secondary", label: "Skipped" },
  };
  
  const c = config[status] || { variant: "outline", label: status };
  return <Badge variant={c.variant} data-testid={`badge-status-${status}`}>{c.label}</Badge>;
}

function MonthName(month: number): string {
  const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
  return months[month - 1] || String(month);
}

function getResultCounts(resultSummary: any) {
  let started = 0, continued = 0, terminated = 0;
  
  if (resultSummary?.actions && Array.isArray(resultSummary.actions)) {
    for (const action of resultSummary.actions) {
      if (action.scanType === "start" && action.eligible) started++;
      else if (action.scanType === "continue") {
        if (action.action === "delete") terminated++;
        else if (action.eligible) continued++;
      }
    }
  }
  
  return { started, continued, terminated };
}

export default function WmbScanDetail() {
  const { id } = useParams<{ id: string }>();

  const { data, isLoading, error } = useQuery<ScanDetailResponse>({
    queryKey: ["/api/wmb-scan/detail", id],
    enabled: !!id,
  });

  const handleExport = () => {
    window.location.href = `/api/wmb-scan/detail/${id}/export`;
  };

  if (isLoading) {
    return (
      <div className="p-6 space-y-6">
        <Skeleton className="h-8 w-64" />
        <Skeleton className="h-48 w-full" />
        <Skeleton className="h-96 w-full" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-2 text-destructive">
              <AlertCircle className="h-5 w-5" />
              <span>Failed to load scan details</span>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  const { status, queueEntries } = data;
  const totalProcessed = status.processedSuccess + status.processedFailed;
  const progressPercent = status.totalQueued > 0 ? (totalProcessed / status.totalQueued) * 100 : 0;

  const statusCounts = queueEntries.reduce((acc, entry) => {
    acc[entry.status] = (acc[entry.status] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between gap-4 flex-wrap">
        <div className="flex items-center gap-4">
          <Link href="/admin/wmb-scan-queue">
            <Button variant="ghost" size="icon" data-testid="button-back">
              <ArrowLeft className="h-4 w-4" />
            </Button>
          </Link>
          <div>
            <h1 className="text-2xl font-semibold" data-testid="text-scan-title">
              Benefits Scan: {MonthName(status.month)} {status.year}
            </h1>
            <p className="text-muted-foreground flex items-center gap-2">
              <Calendar className="h-4 w-4" />
              Queued {format(new Date(status.queuedAt), "MMM d, yyyy 'at' h:mm a")}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={status.status} />
          <Button onClick={handleExport} variant="outline" data-testid="button-export">
            <Download className="h-4 w-4 mr-2" />
            Export CSV
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4">
        <Card>
          <CardHeader className="pb-2">
            <CardDescription>Progress</CardDescription>
            <CardTitle className="text-2xl" data-testid="text-progress">
              {totalProcessed} / {status.totalQueued}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Progress value={progressPercent} className="h-2" />
            <p className="text-xs text-muted-foreground mt-2">
              {status.processedSuccess} succeeded, {status.processedFailed} failed
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              Benefits Started
            </CardDescription>
            <CardTitle className="text-2xl text-green-600 dark:text-green-400" data-testid="text-started">
              {status.benefitsStarted}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Workers newly eligible
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <Minus className="h-3 w-3" />
              Benefits Continued
            </CardDescription>
            <CardTitle className="text-2xl" data-testid="text-continued">
              {status.benefitsContinued}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Workers still eligible
            </p>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="pb-2">
            <CardDescription className="flex items-center gap-1">
              <TrendingDown className="h-3 w-3" />
              Benefits Terminated
            </CardDescription>
            <CardTitle className="text-2xl text-red-600 dark:text-red-400" data-testid="text-terminated">
              {status.benefitsTerminated}
            </CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-xs text-muted-foreground">
              Workers no longer eligible
            </p>
          </CardContent>
        </Card>
      </div>

      {status.startedAt && (
        <Card>
          <CardHeader>
            <CardTitle className="text-lg">Timing</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Started:</span>{" "}
                <span data-testid="text-started-at">{format(new Date(status.startedAt), "MMM d, yyyy 'at' h:mm a")}</span>
              </div>
              {status.completedAt && (
                <div>
                  <span className="text-muted-foreground">Completed:</span>{" "}
                  <span data-testid="text-completed-at">{format(new Date(status.completedAt), "MMM d, yyyy 'at' h:mm a")}</span>
                </div>
              )}
              {status.completedAt && status.startedAt && (
                <div>
                  <span className="text-muted-foreground">Duration:</span>{" "}
                  <span data-testid="text-duration">
                    {Math.round((new Date(status.completedAt).getTime() - new Date(status.startedAt).getTime()) / 1000)}s
                  </span>
                </div>
              )}
            </div>
          </CardContent>
        </Card>
      )}

      {status.lastError && (
        <Card className="border-destructive">
          <CardHeader>
            <CardTitle className="text-lg text-destructive flex items-center gap-2">
              <AlertCircle className="h-4 w-4" />
              Last Error
            </CardTitle>
          </CardHeader>
          <CardContent>
            <pre className="text-sm text-muted-foreground whitespace-pre-wrap" data-testid="text-last-error">
              {status.lastError}
            </pre>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-4">
          <div>
            <CardTitle>Worker Results</CardTitle>
            <CardDescription>
              {queueEntries.length} workers in this scan
            </CardDescription>
          </div>
          <div className="flex gap-2 flex-wrap">
            {Object.entries(statusCounts).map(([status, count]) => (
              <Badge key={status} variant="secondary" data-testid={`badge-count-${status}`}>
                {status}: {count}
              </Badge>
            ))}
          </div>
        </CardHeader>
        <CardContent>
          <div className="rounded-md border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead className="w-24">Sirius ID</TableHead>
                  <TableHead>Worker</TableHead>
                  <TableHead className="w-28">Status</TableHead>
                  <TableHead className="w-32">Source</TableHead>
                  <TableHead className="w-20 text-center">Started</TableHead>
                  <TableHead className="w-20 text-center">Continued</TableHead>
                  <TableHead className="w-20 text-center">Terminated</TableHead>
                  <TableHead className="w-48">Completed</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {queueEntries.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={8} className="text-center text-muted-foreground py-8">
                      No workers in this scan
                    </TableCell>
                  </TableRow>
                ) : (
                  queueEntries.map((entry) => {
                    const counts = getResultCounts(entry.resultSummary);
                    return (
                      <TableRow key={entry.id} data-testid={`row-worker-${entry.workerSiriusId}`}>
                        <TableCell className="font-mono" data-testid={`text-sirius-id-${entry.id}`}>
                          {entry.workerSiriusId || "-"}
                        </TableCell>
                        <TableCell data-testid={`text-worker-name-${entry.id}`}>
                          <div className="flex items-center gap-2">
                            <User className="h-4 w-4 text-muted-foreground" />
                            {entry.workerDisplayName || "Unknown"}
                          </div>
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={entry.status} />
                        </TableCell>
                        <TableCell className="text-muted-foreground text-sm">
                          {entry.triggerSource}
                        </TableCell>
                        <TableCell className="text-center">
                          {counts.started > 0 ? (
                            <span className="text-green-600 dark:text-green-400 font-medium">{counts.started}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {counts.continued > 0 ? (
                            <span className="font-medium">{counts.continued}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-center">
                          {counts.terminated > 0 ? (
                            <span className="text-red-600 dark:text-red-400 font-medium">{counts.terminated}</span>
                          ) : (
                            <span className="text-muted-foreground">-</span>
                          )}
                        </TableCell>
                        <TableCell className="text-sm text-muted-foreground">
                          {entry.completedAt ? format(new Date(entry.completedAt), "MMM d, h:mm a") : "-"}
                        </TableCell>
                      </TableRow>
                    );
                  })
                )}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

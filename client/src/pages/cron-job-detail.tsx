import { useQuery, useMutation } from "@tanstack/react-query";
import { useParams, useLocation, Link } from "wouter";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { ArrowLeft, Clock, Play, Settings, History, Eye } from "lucide-react";
import { format } from "date-fns";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { useToast } from "@/hooks/use-toast";

interface CronJobRun {
  id: string;
  jobName: string;
  status: string;
  output: string | null;
  error: string | null;
  startedAt: string;
  completedAt: string | null;
  triggeredBy: string | null;
  userFirstName?: string | null;
  userLastName?: string | null;
  userEmail?: string | null;
}

interface CronJob {
  name: string;
  description: string | null;
  schedule: string;
  isEnabled: boolean;
  createdAt: string;
  updatedAt: string;
  latestRun?: CronJobRun;
}

function StatusBadge({ status }: { status: string }) {
  const variant = 
    status === 'success' ? 'default' : 
    status === 'error' ? 'destructive' : 
    status === 'running' ? 'secondary' : 
    'outline';
  
  return <Badge variant={variant} data-testid={`badge-status-${status}`}>{status}</Badge>;
}

function formatTriggeredBy(run: CronJobRun): string {
  if (!run.triggeredBy || run.triggeredBy === 'scheduler') {
    return 'Scheduler';
  }
  
  if (run.userEmail) {
    const fullName = [run.userFirstName, run.userLastName].filter(Boolean).join(' ');
    return fullName ? `${fullName} (${run.userEmail})` : run.userEmail;
  }
  
  return run.triggeredBy;
}

export default function CronJobDetail() {
  const { name } = useParams();
  const [, setLocation] = useLocation();
  const { toast } = useToast();

  const { data: job, isLoading: jobLoading } = useQuery<CronJob>({
    queryKey: ["/api/cron-jobs", name],
    queryFn: async () => {
      const response = await fetch(`/api/cron-jobs/${encodeURIComponent(name!)}`);
      if (!response.ok) throw new Error('Failed to fetch cron job');
      return response.json();
    },
    enabled: !!name,
  });

  const { data: runs = [], isLoading: runsLoading } = useQuery<CronJobRun[]>({
    queryKey: ["/api/cron-jobs", name, "runs"],
    queryFn: async () => {
      const response = await fetch(`/api/cron-jobs/${encodeURIComponent(name!)}/runs`);
      if (!response.ok) throw new Error('Failed to fetch run history');
      return response.json();
    },
    enabled: !!name,
  });

  const runMutation = useMutation({
    mutationFn: async () => {
      return await apiRequest("POST", `/api/cron-jobs/${encodeURIComponent(name!)}/run`, {});
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cron-jobs", name] });
      queryClient.invalidateQueries({ queryKey: ["/api/cron-jobs", name, "runs"] });
      toast({
        title: "Job Started",
        description: "The cron job has been manually triggered.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Run Job",
        description: error.message || "Failed to trigger the cron job",
        variant: "destructive",
      });
    },
  });

  const toggleMutation = useMutation({
    mutationFn: async (isEnabled: boolean) => {
      return await apiRequest("PATCH", `/api/cron-jobs/${encodeURIComponent(name!)}`, { isEnabled });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/cron-jobs", name] });
      queryClient.invalidateQueries({ queryKey: ["/api/cron-jobs"] });
      toast({
        title: "Job Updated",
        description: "Cron job status has been updated.",
      });
    },
    onError: (error: Error) => {
      toast({
        title: "Failed to Update Job",
        description: error.message || "Failed to update cron job",
        variant: "destructive",
      });
    },
  });

  if (jobLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Skeleton className="h-10 w-64 mb-8" />
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (!job) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Card>
          <CardContent className="py-12 text-center">
            <h3 className="text-lg font-semibold mb-2">Job Not Found</h3>
            <p className="text-sm text-muted-foreground mb-4">
              The requested cron job could not be found.
            </p>
            <Button onClick={() => setLocation("/cron-jobs")} data-testid="button-back-to-list">
              Back to Cron Jobs
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
      <div className="mb-8">
        <Link href="/cron-jobs">
          <Button variant="ghost" size="sm" className="mb-4" data-testid="button-back">
            <ArrowLeft className="h-4 w-4 mr-2" />
            Back to Cron Jobs
          </Button>
        </Link>
        <h1 className="text-3xl font-bold text-foreground">{job.name}</h1>
        {job.description && (
          <p className="text-muted-foreground mt-2">{job.description}</p>
        )}
        <div className="flex items-center gap-4 mt-4">
          <div className="flex items-center gap-2">
            <Clock className="h-4 w-4 text-muted-foreground" />
            <span className="text-sm text-muted-foreground">Schedule: {job.schedule}</span>
          </div>
          <Badge variant={job.isEnabled ? "default" : "secondary"} data-testid="badge-job-status">
            {job.isEnabled ? "Enabled" : "Disabled"}
          </Badge>
        </div>
      </div>

      <Tabs defaultValue="view" className="space-y-4">
        <TabsList>
          <TabsTrigger value="view" data-testid="tab-view">
            <Eye className="h-4 w-4 mr-2" />
            View
          </TabsTrigger>
          <TabsTrigger value="settings" data-testid="tab-settings">
            <Settings className="h-4 w-4 mr-2" />
            Settings
          </TabsTrigger>
          <TabsTrigger value="history" data-testid="tab-history">
            <History className="h-4 w-4 mr-2" />
            History
          </TabsTrigger>
        </TabsList>

        <TabsContent value="view">
          <Card>
            <CardHeader>
              <CardTitle>Latest Run</CardTitle>
              <CardDescription>Most recent execution status and details</CardDescription>
            </CardHeader>
            <CardContent>
              {job.latestRun ? (
                <div className="space-y-4">
                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Status</p>
                      <div className="mt-1">
                        <StatusBadge status={job.latestRun.status} />
                      </div>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Triggered By</p>
                      <p className="text-sm mt-1" data-testid="text-triggered-by">
                        {formatTriggeredBy(job.latestRun)}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Started At</p>
                      <p className="text-sm mt-1" data-testid="text-started-at">
                        {format(new Date(job.latestRun.startedAt), "MMM d, yyyy HH:mm:ss")}
                      </p>
                    </div>
                    <div>
                      <p className="text-sm font-medium text-muted-foreground">Completed At</p>
                      <p className="text-sm mt-1" data-testid="text-completed-at">
                        {job.latestRun.completedAt 
                          ? format(new Date(job.latestRun.completedAt), "MMM d, yyyy HH:mm:ss")
                          : "In Progress"}
                      </p>
                    </div>
                  </div>
                  {(job.latestRun.output || job.latestRun.error) && (
                    <div>
                      <p className="text-sm font-medium text-muted-foreground mb-2">
                        {job.latestRun.error ? "Error" : "Output"}
                      </p>
                      <pre className="text-sm bg-muted p-4 rounded-md overflow-x-auto" data-testid="text-output">
                        {job.latestRun.error || job.latestRun.output}
                      </pre>
                    </div>
                  )}
                </div>
              ) : (
                <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-runs">
                  No runs yet. This job hasn't been executed.
                </p>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="settings">
          <Card>
            <CardHeader>
              <CardTitle>Job Settings</CardTitle>
              <CardDescription>Configure and manage this cron job</CardDescription>
            </CardHeader>
            <CardContent className="space-y-6">
              <div className="flex items-center justify-between">
                <div>
                  <p className="font-medium">Enable Job</p>
                  <p className="text-sm text-muted-foreground">
                    Allow this job to run on its schedule
                  </p>
                </div>
                <Switch
                  checked={job.isEnabled}
                  onCheckedChange={(checked) => toggleMutation.mutate(checked)}
                  disabled={toggleMutation.isPending}
                  data-testid="switch-enabled"
                />
              </div>
              <div className="pt-6 border-t">
                <p className="font-medium mb-2">Manual Execution</p>
                <p className="text-sm text-muted-foreground mb-4">
                  Trigger this job to run immediately, regardless of schedule
                </p>
                <Button
                  onClick={() => runMutation.mutate()}
                  disabled={runMutation.isPending}
                  data-testid="button-run-now"
                >
                  <Play className="h-4 w-4 mr-2" />
                  Run Now
                </Button>
              </div>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history">
          <Card>
            <CardHeader>
              <CardTitle>Run History</CardTitle>
              <CardDescription>Complete execution history for this job</CardDescription>
            </CardHeader>
            <CardContent>
              {runsLoading ? (
                <div className="space-y-2">
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                  <Skeleton className="h-12" />
                </div>
              ) : runs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-history">
                  No runs yet. This job hasn't been executed.
                </p>
              ) : (
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead>Started</TableHead>
                      <TableHead>Completed</TableHead>
                      <TableHead>Status</TableHead>
                      <TableHead>Triggered By</TableHead>
                      <TableHead>Output/Error</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {runs.map((run) => (
                      <TableRow key={run.id} data-testid={`row-run-${run.id}`}>
                        <TableCell className="text-sm">
                          {format(new Date(run.startedAt), "MMM d, yyyy HH:mm:ss")}
                        </TableCell>
                        <TableCell className="text-sm">
                          {run.completedAt ? format(new Date(run.completedAt), "MMM d, yyyy HH:mm:ss") : "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={run.status} />
                        </TableCell>
                        <TableCell className="text-sm">
                          {formatTriggeredBy(run)}
                        </TableCell>
                        <TableCell className="text-sm max-w-xs truncate">
                          {run.error || run.output || "—"}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              )}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

import { useQuery } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { DispatchJobLayout, useDispatchJobLayout } from "@/components/layouts/DispatchJobLayout";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Users, CheckCircle, XCircle, Bell, Clock, Pause, LogOut, Percent, Timer,
  type LucideIcon
} from "lucide-react";
import type { JobTypeData, DispatchJobData } from "@shared/schema";

interface DispatchStatusCounts {
  pending: number;
  notified: number;
  accepted: number;
  layoff: number;
  resigned: number;
  declined: number;
}

const statusConfig: Record<keyof DispatchStatusCounts, { label: string; icon: LucideIcon; color: string }> = {
  pending: { label: "Pending", icon: Clock, color: "text-yellow-600 dark:text-yellow-400" },
  notified: { label: "Notified", icon: Bell, color: "text-blue-600 dark:text-blue-400" },
  accepted: { label: "Accepted", icon: CheckCircle, color: "text-green-600 dark:text-green-400" },
  declined: { label: "Declined", icon: XCircle, color: "text-red-600 dark:text-red-400" },
  layoff: { label: "Layoff", icon: Pause, color: "text-orange-600 dark:text-orange-400" },
  resigned: { label: "Resigned", icon: LogOut, color: "text-muted-foreground" },
};

interface EligibleWorkersResponse {
  total: number;
}

function RunBatchContent() {
  const { job } = useDispatchJobLayout();

  const jobData = job.data as DispatchJobData | undefined;
  const jobTypeData = job.jobType?.data as JobTypeData | undefined;

  const resolvedOfferRatio = jobData?.offerRatio ?? jobTypeData?.offerRatio;
  const resolvedOfferTimeout = jobData?.offerTimeout ?? jobTypeData?.offerTimeout;

  const isJobOverride = (field: 'offerRatio' | 'offerTimeout') => {
    return jobData?.[field] !== undefined;
  };

  const { data: eligibleData, isLoading: eligLoading } = useQuery<EligibleWorkersResponse>({
    queryKey: [`/api/dispatch-jobs/${job.id}/eligible-workers?limit=1&offset=0`],
  });

  return (
    <div className="space-y-4">
      {job.workerCount != null && (
        <Card>
          <CardHeader>
            <CardTitle data-testid="title-capacity">Capacity</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <div className="flex items-center justify-between gap-2 text-sm">
              <span className="flex items-center gap-2">
                <Users className="h-4 w-4 text-muted-foreground" />
                <span>Accepted Dispatches</span>
              </span>
              <span className="font-medium" data-testid="text-accepted-ratio">
                {job.acceptedCount ?? 0} / {job.workerCount}
              </span>
            </div>
            <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
              <div
                className="h-full bg-primary transition-all duration-300"
                style={{
                  width: `${job.workerCount > 0 ? Math.min(100, ((job.acceptedCount ?? 0) / job.workerCount) * 100) : 0}%`
                }}
                data-testid="progress-bar"
              />
            </div>
            {(job.acceptedCount ?? 0) >= job.workerCount && (
              <p className="text-sm text-green-600 dark:text-green-400 font-medium">
                Fully staffed
              </p>
            )}
            {job.statusCounts && (
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2 pt-2 border-t" data-testid="dispatch-status-counts">
                {(Object.keys(statusConfig) as Array<keyof DispatchStatusCounts>).map((status) => {
                  const config = statusConfig[status];
                  const count = job.statusCounts?.[status] ?? 0;
                  const Icon = config.icon;
                  return (
                    <div
                      key={status}
                      className="flex items-center gap-2 text-sm"
                      data-testid={`status-count-${status}`}
                    >
                      <Icon className={`h-4 w-4 ${config.color}`} />
                      <span className="text-muted-foreground">{config.label}:</span>
                      <span className="font-medium">{count}</span>
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle data-testid="title-run-params">Run Parameters</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="flex items-start gap-3" data-testid="param-offer-ratio">
              <Percent className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Offer Ratio</p>
                {resolvedOfferRatio !== undefined ? (
                  <p className="text-sm text-foreground">
                    {resolvedOfferRatio}
                    {isJobOverride('offerRatio') ? (
                      <span className="text-muted-foreground ml-1">(job override)</span>
                    ) : (
                      <span className="text-muted-foreground ml-1">(from job type)</span>
                    )}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Not configured</p>
                )}
              </div>
            </div>
            <div className="flex items-start gap-3" data-testid="param-offer-timeout">
              <Timer className="h-4 w-4 mt-0.5 text-muted-foreground" />
              <div>
                <p className="text-sm font-medium">Offer Timeout</p>
                {resolvedOfferTimeout !== undefined ? (
                  <p className="text-sm text-foreground">
                    {resolvedOfferTimeout} minutes
                    {isJobOverride('offerTimeout') ? (
                      <span className="text-muted-foreground ml-1">(job override)</span>
                    ) : (
                      <span className="text-muted-foreground ml-1">(from job type)</span>
                    )}
                  </p>
                ) : (
                  <p className="text-sm text-muted-foreground">Not configured</p>
                )}
              </div>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle data-testid="title-eligible-workers">Eligible Workers</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center gap-3">
            <Users className="h-5 w-5 text-muted-foreground" />
            {eligLoading ? (
              <Skeleton className="h-5 w-24" />
            ) : (
              <p className="text-sm" data-testid="text-eligible-count">
                <span className="font-medium text-lg">{eligibleData?.total ?? 0}</span>
                <span className="text-muted-foreground ml-1">eligible workers</span>
              </p>
            )}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function DispatchJobRunBatchPage() {
  return (
    <DispatchJobLayout activeTab="run-batch">
      <RunBatchContent />
    </DispatchJobLayout>
  );
}

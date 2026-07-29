import { EdlsSheetLayout, useEdlsSheetLayout } from "@/components/layouts/EdlsSheetLayout";
import { useQuery } from "@tanstack/react-query";
import { useMemo } from "react";
import { Link } from "wouter";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Users, Clock, User } from "lucide-react";
import { formatYmd } from "@shared/utils/date";
import type { EdlsCrewWithRelations, AssignmentWithWorker } from "@/components/edls/SheetDetailsView";

interface NextAssignment {
  assignmentId: string;
  ymd: string;
  sheetId: string;
  sheetTitle: string;
  sheetStatus: string;
  crewId: string;
  crewTitle: string;
  startTime: string | null;
  endTime: string | null;
  supervisor: { id: string; firstName: string | null; lastName: string | null; email: string } | null;
  facility: { id: string; name: string } | null;
  jobGroup: { id: string; name: string } | null;
  department: { id: string; name: string } | null;
  data: Record<string, unknown> | null;
}

function formatWorkerName(worker: AssignmentWithWorker["worker"]): string {
  if (worker.family && worker.given) return `${worker.family}, ${worker.given}`;
  if (worker.family) return worker.family;
  if (worker.given) return worker.given;
  if (worker.displayName) return worker.displayName;
  return `Worker ${worker.siriusId || worker.id.slice(0, 8)}`;
}

function formatUserName(user: NextAssignment["supervisor"]): string {
  if (!user) return "—";
  if (user.firstName || user.lastName) {
    return [user.firstName, user.lastName].filter(Boolean).join(" ");
  }
  return user.email;
}

function formatTime(time: string | null | undefined): string {
  if (!time) return "";
  const [hours, minutes] = time.split(":");
  const hour = parseInt(hours, 10);
  const ampm = hour >= 12 ? "PM" : "AM";
  const hour12 = hour % 12 || 12;
  return `${hour12}:${minutes} ${ampm}`;
}

function NextAssignmentsContent() {
  const { sheet } = useEdlsSheetLayout();

  const { data: crews = [], isLoading: crewsLoading } = useQuery<EdlsCrewWithRelations[]>({
    queryKey: ["/api/edls/sheets", sheet.id, "crews"],
  });

  const { data: assignments = [], isLoading: assignmentsLoading } = useQuery<AssignmentWithWorker[]>({
    queryKey: ["/api/edls/sheets", sheet.id, "assignments"],
  });

  const { data: nextData, isLoading: nextLoading } = useQuery<{ next: Record<string, NextAssignment | null> }>({
    queryKey: ["/api/edls/sheets", sheet.id, "next-assignments"],
  });

  const assignmentsByCrewId = useMemo(() => {
    return assignments.reduce((acc, a) => {
      if (!acc[a.crewId]) acc[a.crewId] = [];
      acc[a.crewId].push(a);
      return acc;
    }, {} as Record<string, AssignmentWithWorker[]>);
  }, [assignments]);

  const isLoading = crewsLoading || assignmentsLoading || nextLoading;

  if (isLoading) {
    return (
      <div className="space-y-3">
        <Skeleton className="h-24 w-full" />
        <Skeleton className="h-24 w-full" />
      </div>
    );
  }

  if (crews.length === 0) {
    return (
      <p className="text-muted-foreground text-center py-4" data-testid="text-no-crews">
        No crews assigned to this sheet.
      </p>
    );
  }

  const nextMap = nextData?.next ?? {};

  return (
    <div className="space-y-3">
      {crews.map((crew) => {
        const crewAssignments = assignmentsByCrewId[crew.id] || [];
        return (
          <Card key={crew.id} data-testid={`next-crew-card-${crew.id}`}>
            <CardHeader className="pb-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <CardTitle className="text-base" data-testid={`next-crew-title-${crew.id}`}>
                  {crew.title}
                </CardTitle>
                <Badge variant="secondary" data-testid={`next-crew-count-${crew.id}`}>
                  <Users className="h-3 w-3 mr-1" />
                  {crewAssignments.length} workers
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              {crewAssignments.length === 0 ? (
                <p className="text-sm text-muted-foreground" data-testid={`text-no-workers-${crew.id}`}>
                  No workers assigned to this crew.
                </p>
              ) : (
                <div className="divide-y">
                  {crewAssignments.map((a) => {
                    const next = nextMap[a.workerId] ?? null;
                    const overrideStart = (next?.data as { startTime?: string | null } | null)?.startTime;
                    return (
                      <div
                        key={a.id}
                        className="py-2 flex flex-col sm:flex-row sm:items-center gap-1 sm:gap-4"
                        data-testid={`next-row-${a.id}`}
                      >
                        <div className="sm:w-56 shrink-0 flex items-center gap-2 min-w-0">
                          <span className="truncate font-medium" data-testid={`text-worker-name-${a.id}`}>
                            {formatWorkerName(a.worker)}
                          </span>
                          {a.worker.siriusId && (
                            <span className="text-xs text-muted-foreground tabular-nums">
                              #{a.worker.siriusId}
                            </span>
                          )}
                        </div>
                        {next ? (
                          <div
                            className="flex flex-wrap items-center gap-x-4 gap-y-1 text-sm text-muted-foreground min-w-0"
                            data-testid={`next-assignment-${a.id}`}
                          >
                            <Link
                              href={`/edls/sheet/${next.sheetId}`}
                              className="text-primary hover:underline truncate max-w-[240px]"
                              data-testid={`link-next-sheet-${a.id}`}
                            >
                              {next.sheetTitle}
                            </Link>
                            <span data-testid={`text-next-date-${a.id}`}>{formatYmd(next.ymd, 'long')}</span>
                            <span className="flex items-center gap-1" data-testid={`text-next-start-${a.id}`}>
                              <Clock className="h-3.5 w-3.5" />
                              {formatTime(overrideStart || next.startTime)}
                            </span>
                            {next.department && <span data-testid={`text-next-department-${a.id}`}>{next.department.name}</span>}
                            {next.facility && <span data-testid={`text-next-facility-${a.id}`}>{next.facility.name}</span>}
                            {next.jobGroup && <span data-testid={`text-next-jobgroup-${a.id}`}>{next.jobGroup.name}</span>}
                            {next.supervisor && (
                              <span className="flex items-center gap-1" data-testid={`text-next-supervisor-${a.id}`}>
                                <User className="h-3.5 w-3.5" />
                                {formatUserName(next.supervisor)}
                              </span>
                            )}
                          </div>
                        ) : (
                          <span className="text-sm text-muted-foreground italic" data-testid={`text-none-scheduled-${a.id}`}>
                            None scheduled
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </CardContent>
          </Card>
        );
      })}
    </div>
  );
}

export default function EdlsSheetNextAssignmentsPage() {
  return (
    <EdlsSheetLayout activeTab="next-assignments">
      <NextAssignmentsContent />
    </EdlsSheetLayout>
  );
}

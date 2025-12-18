import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { WorkerLayout, useWorkerLayout } from "@/components/layouts/WorkerLayout";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import { BargainingUnit, Employer, WorkerStewardAssignment } from "@shared/schema";
import { Link } from "wouter";
import { ExternalLink, Plus, Trash2 } from "lucide-react";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

const NONE_VALUE = "__none__";

interface WorkerStewardAssignmentWithDetails extends WorkerStewardAssignment {
  employer?: { id: string; name: string };
  bargainingUnit?: { id: string; name: string };
}

function StewardAssignmentsSection() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const [isAddingAssignment, setIsAddingAssignment] = useState(false);
  const [selectedEmployerId, setSelectedEmployerId] = useState<string>(
    worker.denormHomeEmployerId || NONE_VALUE
  );
  const [selectedBargainingUnitId, setSelectedBargainingUnitId] = useState<string>(
    worker.bargainingUnitId || NONE_VALUE
  );
  const [deleteAssignmentId, setDeleteAssignmentId] = useState<string | null>(null);

  const { data: assignments = [], isLoading: isLoadingAssignments } = useQuery<WorkerStewardAssignmentWithDetails[]>({
    queryKey: ["/api/workers", worker.id, "steward-assignments"],
  });

  const { data: employers = [] } = useQuery<Employer[]>({
    queryKey: ["/api/employers"],
  });

  const { data: bargainingUnits = [] } = useQuery<BargainingUnit[]>({
    queryKey: ["/api/bargaining-units"],
  });

  const createMutation = useMutation({
    mutationFn: async (data: { employerId: string; bargainingUnitId: string }) => {
      return await apiRequest("POST", `/api/workers/${worker.id}/steward-assignments`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "steward-assignments"] });
      setIsAddingAssignment(false);
      setSelectedEmployerId(worker.denormHomeEmployerId || NONE_VALUE);
      setSelectedBargainingUnitId(worker.bargainingUnitId || NONE_VALUE);
      toast({
        title: "Success",
        description: "Steward assignment added successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to add steward assignment",
        variant: "destructive",
      });
    },
  });

  const deleteMutation = useMutation({
    mutationFn: async (assignmentId: string) => {
      return await apiRequest("DELETE", `/api/workers/${worker.id}/steward-assignments/${assignmentId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id, "steward-assignments"] });
      setDeleteAssignmentId(null);
      toast({
        title: "Success",
        description: "Steward assignment removed successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to remove steward assignment",
        variant: "destructive",
      });
    },
  });

  const handleAddAssignment = () => {
    if (selectedEmployerId === NONE_VALUE || selectedBargainingUnitId === NONE_VALUE) {
      toast({
        title: "Error",
        description: "Please select both an employer and a bargaining unit",
        variant: "destructive",
      });
      return;
    }
    createMutation.mutate({
      employerId: selectedEmployerId,
      bargainingUnitId: selectedBargainingUnitId,
    });
  };

  const handleCancelAdd = () => {
    setIsAddingAssignment(false);
    setSelectedEmployerId(worker.denormHomeEmployerId || NONE_VALUE);
    setSelectedBargainingUnitId(worker.bargainingUnitId || NONE_VALUE);
  };

  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <div>
          <CardTitle>Steward Assignments</CardTitle>
          <CardDescription>
            Manage the employer and bargaining unit combinations this worker is a steward for
          </CardDescription>
        </div>
        {!isAddingAssignment && (
          <Button
            onClick={() => setIsAddingAssignment(true)}
            size="sm"
            data-testid="button-add-steward-assignment"
          >
            <Plus className="h-4 w-4 mr-1" />
            Add Assignment
          </Button>
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        {isAddingAssignment && (
          <div className="border rounded-md p-4 space-y-4 bg-muted/30">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Employer</Label>
                <Select
                  value={selectedEmployerId}
                  onValueChange={setSelectedEmployerId}
                >
                  <SelectTrigger data-testid="select-assignment-employer">
                    <SelectValue placeholder="Select an employer" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>(Select an employer)</SelectItem>
                    {employers.map((employer) => (
                      <SelectItem key={employer.id} value={employer.id}>
                        {employer.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Bargaining Unit</Label>
                <Select
                  value={selectedBargainingUnitId}
                  onValueChange={setSelectedBargainingUnitId}
                >
                  <SelectTrigger data-testid="select-assignment-bargaining-unit">
                    <SelectValue placeholder="Select a bargaining unit" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value={NONE_VALUE}>(Select a bargaining unit)</SelectItem>
                    {bargainingUnits.map((unit) => (
                      <SelectItem key={unit.id} value={unit.id}>
                        {unit.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="flex gap-2">
              <Button
                onClick={handleAddAssignment}
                disabled={createMutation.isPending || selectedEmployerId === NONE_VALUE || selectedBargainingUnitId === NONE_VALUE}
                data-testid="button-save-steward-assignment"
              >
                {createMutation.isPending ? "Adding..." : "Add"}
              </Button>
              <Button
                variant="outline"
                onClick={handleCancelAdd}
                data-testid="button-cancel-steward-assignment"
              >
                Cancel
              </Button>
            </div>
          </div>
        )}

        {isLoadingAssignments ? (
          <p className="text-muted-foreground text-sm">Loading assignments...</p>
        ) : assignments.length === 0 ? (
          <p className="text-muted-foreground text-sm" data-testid="text-no-steward-assignments">
            No steward assignments yet. Click "Add Assignment" to create one.
          </p>
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Employer</TableHead>
                <TableHead>Bargaining Unit</TableHead>
                <TableHead className="w-[80px]">Actions</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {assignments.map((assignment) => (
                <TableRow key={assignment.id} data-testid={`row-steward-assignment-${assignment.id}`}>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{assignment.employer?.name || "Unknown Employer"}</span>
                      {assignment.employer?.id && (
                        <Link href={`/employers/${assignment.employer.id}`}>
                          <Button variant="ghost" size="icon" className="h-6 w-6">
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </Link>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center gap-2">
                      <span>{assignment.bargainingUnit?.name || "Unknown Unit"}</span>
                      {assignment.bargainingUnit?.id && (
                        <Link href={`/bargaining-units/${assignment.bargainingUnit.id}`}>
                          <Button variant="ghost" size="icon" className="h-6 w-6">
                            <ExternalLink className="h-3 w-3" />
                          </Button>
                        </Link>
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Button
                      variant="ghost"
                      size="icon"
                      onClick={() => setDeleteAssignmentId(assignment.id)}
                      data-testid={`button-delete-steward-assignment-${assignment.id}`}
                    >
                      <Trash2 className="h-4 w-4 text-destructive" />
                    </Button>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}

        <AlertDialog open={!!deleteAssignmentId} onOpenChange={() => setDeleteAssignmentId(null)}>
          <AlertDialogContent>
            <AlertDialogHeader>
              <AlertDialogTitle>Remove Steward Assignment</AlertDialogTitle>
              <AlertDialogDescription>
                Are you sure you want to remove this steward assignment? This action cannot be undone.
              </AlertDialogDescription>
            </AlertDialogHeader>
            <AlertDialogFooter>
              <AlertDialogCancel data-testid="button-cancel-delete-assignment">Cancel</AlertDialogCancel>
              <AlertDialogAction
                onClick={() => deleteAssignmentId && deleteMutation.mutate(deleteAssignmentId)}
                data-testid="button-confirm-delete-assignment"
              >
                {deleteMutation.isPending ? "Removing..." : "Remove"}
              </AlertDialogAction>
            </AlertDialogFooter>
          </AlertDialogContent>
        </AlertDialog>
      </CardContent>
    </Card>
  );
}

function WorkerBargainingUnitContent() {
  const { worker } = useWorkerLayout();
  const { toast } = useToast();
  const [selectedBargainingUnitId, setSelectedBargainingUnitId] = useState<string>(
    worker.bargainingUnitId || NONE_VALUE
  );

  const { data: bargainingUnits = [], isLoading: isLoadingUnits } = useQuery<BargainingUnit[]>({
    queryKey: ["/api/bargaining-units"],
  });

  const currentBargainingUnit = bargainingUnits.find(bu => bu.id === worker.bargainingUnitId);

  const updateMutation = useMutation({
    mutationFn: async (bargainingUnitId: string | null) => {
      return await apiRequest("PATCH", `/api/workers/${worker.id}`, {
        bargainingUnitId,
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/workers", worker.id] });
      toast({
        title: "Success",
        description: "Bargaining unit updated successfully",
      });
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update bargaining unit",
        variant: "destructive",
      });
    },
  });

  const handleSave = () => {
    const newValue = selectedBargainingUnitId === NONE_VALUE ? null : selectedBargainingUnitId;
    updateMutation.mutate(newValue);
  };

  const currentValue = worker.bargainingUnitId || NONE_VALUE;
  const hasChanges = selectedBargainingUnitId !== currentValue;

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader>
          <CardTitle>Bargaining Unit</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="bargaining-unit">Current Bargaining Unit</Label>
              {currentBargainingUnit ? (
                <div className="flex items-center gap-2">
                  <span className="text-foreground font-medium" data-testid="text-current-bargaining-unit">
                    {currentBargainingUnit.name}
                  </span>
                  <Link href={`/bargaining-units/${currentBargainingUnit.id}`}>
                    <Button variant="ghost" size="sm" data-testid="button-view-bargaining-unit">
                      <ExternalLink size={14} />
                    </Button>
                  </Link>
                </div>
              ) : (
                <p className="text-muted-foreground text-sm" data-testid="text-no-bargaining-unit">
                  No bargaining unit assigned
                </p>
              )}
            </div>

            <div className="space-y-2">
              <Label htmlFor="select-bargaining-unit">Change Bargaining Unit</Label>
              <Select
                value={selectedBargainingUnitId}
                onValueChange={setSelectedBargainingUnitId}
                disabled={isLoadingUnits}
              >
                <SelectTrigger data-testid="select-bargaining-unit">
                  <SelectValue placeholder="Select a bargaining unit" />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value={NONE_VALUE} data-testid="option-no-bargaining-unit">
                    (None)
                  </SelectItem>
                  {bargainingUnits.map((unit) => (
                    <SelectItem key={unit.id} value={unit.id} data-testid={`option-bargaining-unit-${unit.id}`}>
                      {unit.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div className="flex gap-2">
              <Button
                onClick={handleSave}
                disabled={!hasChanges || updateMutation.isPending}
                data-testid="button-save-bargaining-unit"
              >
                {updateMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
              {hasChanges && (
                <Button
                  variant="outline"
                  onClick={() => setSelectedBargainingUnitId(worker.bargainingUnitId || NONE_VALUE)}
                  data-testid="button-cancel-bargaining-unit"
                >
                  Cancel
                </Button>
              )}
            </div>
          </div>
        </CardContent>
      </Card>

      <StewardAssignmentsSection />
    </div>
  );
}

export default function WorkerBargainingUnit() {
  return (
    <WorkerLayout activeTab="bargaining-unit">
      <WorkerBargainingUnitContent />
    </WorkerLayout>
  );
}

import { useState } from "react";
import { Link } from "wouter";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Save } from "lucide-react";
import { EmployerLayout, useEmployerLayout } from "@/components/layouts/EmployerLayout";

function EmployerEditContent() {
  const { employer } = useEmployerLayout();
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editName, setEditName] = useState(employer.name);
  const [editIsActive, setEditIsActive] = useState(employer.isActive);

  const updateEmployerMutation = useMutation({
    mutationFn: async (data: { name: string; isActive: boolean }) => {
      const response = await apiRequest("PUT", `/api/employers/${employer.id}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employers", employer.id] });
      queryClient.invalidateQueries({ queryKey: ["/api/employers"] });
      toast({
        title: "Success",
        description: "Employer updated successfully!",
      });
    },
    onError: (error: any) => {
      const message = error.message || "Failed to update employer. Please try again.";
      toast({
        title: "Error",
        description: message,
        variant: "destructive",
      });
    },
  });

  const handleSaveEdit = () => {
    if (editName.trim()) {
      updateEmployerMutation.mutate({ name: editName.trim(), isActive: editIsActive });
    }
  };

  return (
    <Card>
      <CardContent className="space-y-6">
        <div>
          <h3 className="text-lg font-semibold text-foreground mb-3">Edit Employer</h3>
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="edit-employer-name" className="text-sm font-medium text-foreground">
                Employer Name
              </Label>
              <Input
                id="edit-employer-name"
                type="text"
                placeholder="Enter employer name..."
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                className="w-full"
                data-testid="input-edit-employer-name"
              />
            </div>
            <div className="flex items-center space-x-2">
              <Checkbox
                id="edit-employer-active"
                checked={editIsActive}
                onCheckedChange={(checked) => setEditIsActive(checked === true)}
                data-testid="checkbox-edit-employer-active"
              />
              <Label
                htmlFor="edit-employer-active"
                className="text-sm font-medium text-foreground cursor-pointer"
              >
                Active
              </Label>
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="pt-4 border-t border-border">
          <div className="flex items-center space-x-3">
            <Button
              onClick={handleSaveEdit}
              disabled={updateEmployerMutation.isPending || !editName.trim()}
              data-testid="button-save-employer"
            >
              <Save className="mr-2" size={16} />
              {updateEmployerMutation.isPending ? "Saving..." : "Save Changes"}
            </Button>
            <Link href="/employers">
              <Button variant="outline" data-testid="button-back-to-list">
                Back to List
              </Button>
            </Link>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function EmployerEdit() {
  return (
    <EmployerLayout activeTab="edit">
      <EmployerEditContent />
    </EmployerLayout>
  );
}

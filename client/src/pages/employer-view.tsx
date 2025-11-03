import { Building2, Save } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Employer } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { useState } from "react";

export default function EmployerView() {
  const params = useParams();
  const employerId = params.id;
  const { toast } = useToast();
  const queryClient = useQueryClient();

  const [editName, setEditName] = useState("");
  const [editIsActive, setEditIsActive] = useState(true);

  const { data: employer, isLoading } = useQuery<Employer>({
    queryKey: ["/api/employers", employerId],
    queryFn: async () => {
      const response = await fetch(`/api/employers/${employerId}`);
      if (!response.ok) {
        throw new Error("Failed to fetch employer");
      }
      return response.json();
    },
  });

  const updateEmployerMutation = useMutation({
    mutationFn: async (data: { name: string; isActive: boolean }) => {
      const response = await apiRequest("PUT", `/api/employers/${employerId}`, data);
      return response.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/employers", employerId] });
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

  const handleTabChange = (value: string) => {
    if (value === "edit" && employer) {
      setEditName(employer.name);
      setEditIsActive(employer.isActive);
    }
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b border-border bg-card">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex items-center space-x-3">
              <Building2 className="text-primary" size={32} />
              <div>
                <h1 className="text-2xl font-bold text-foreground">Loading...</h1>
              </div>
            </div>
          </div>
        </div>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="p-8 text-center text-muted-foreground">
              Loading employer details...
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  if (!employer) {
    return (
      <div className="min-h-screen bg-background">
        <div className="border-b border-border bg-card">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
            <div className="flex items-center space-x-3">
              <Building2 className="text-primary" size={32} />
              <div>
                <h1 className="text-2xl font-bold text-foreground">Employer Not Found</h1>
              </div>
            </div>
          </div>
        </div>
        <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <Card>
            <CardContent className="p-8 text-center">
              <p className="text-muted-foreground mb-4">
                The employer you're looking for could not be found.
              </p>
              <Link href="/employers">
                <Button variant="outline" data-testid="button-back-to-list">
                  Back to Employers
                </Button>
              </Link>
            </CardContent>
          </Card>
        </main>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="border-b border-border bg-card">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-6">
          <div className="flex items-center space-x-3">
            <Building2 className="text-primary" size={32} />
            <div>
              <h1 className="text-2xl font-bold text-foreground" data-testid="text-employer-name">
                {employer.name}
              </h1>
              <p className="text-sm text-muted-foreground">Employer Details</p>
            </div>
          </div>
        </div>
      </div>

      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        <Tabs defaultValue="details" onValueChange={handleTabChange}>
          <TabsList className="mb-4" data-testid="tabs-employer">
            <TabsTrigger value="details" data-testid="tab-details">Details</TabsTrigger>
            <TabsTrigger value="edit" data-testid="tab-edit">Edit</TabsTrigger>
          </TabsList>

          <TabsContent value="details">
            <Card>
              <CardContent className="space-y-6">
                {/* Basic Information */}
                <div>
                  <h3 className="text-lg font-semibold text-foreground mb-3">Basic Information</h3>
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-muted-foreground">Employer Name</label>
                      <p className="text-foreground" data-testid="text-employer-name-field">
                        {employer.name}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-muted-foreground">Record ID</label>
                      <p className="text-foreground font-mono text-sm" data-testid="text-employer-id">
                        {employer.id}
                      </p>
                    </div>
                    <div className="space-y-2">
                      <label className="text-sm font-medium text-muted-foreground">Status</label>
                      <div>
                        <Badge 
                          variant={employer.isActive ? "default" : "secondary"}
                          data-testid="badge-employer-status"
                        >
                          {employer.isActive ? "Active" : "Inactive"}
                        </Badge>
                      </div>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-4 border-t border-border">
                  <div className="flex items-center space-x-3">
                    <Link href="/employers">
                      <Button variant="outline" data-testid="button-back-to-list">
                        Back to List
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>

          <TabsContent value="edit">
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
                      <Button variant="outline" data-testid="button-back-to-list-edit">
                        Back to List
                      </Button>
                    </Link>
                  </div>
                </div>
              </CardContent>
            </Card>
          </TabsContent>
        </Tabs>
      </main>
    </div>
  );
}

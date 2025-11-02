import { Building2 } from "lucide-react";
import { Link, useParams } from "wouter";
import { useQuery } from "@tanstack/react-query";
import { Employer } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

export default function EmployerView() {
  const params = useParams();
  const employerId = params.id;

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
      </main>
    </div>
  );
}

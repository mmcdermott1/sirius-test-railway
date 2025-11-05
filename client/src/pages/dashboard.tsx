import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { PageHeader } from "@/components/layout/PageHeader";
import { Home } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { useAuth } from "@/contexts/AuthContext";
import { Role } from "@shared/schema";
import DOMPurify from "isomorphic-dompurify";

export default function Dashboard() {
  const { user } = useAuth();
  
  const { data: userRoles = [] } = useQuery<Role[]>({
    queryKey: ["/api/users", user?.id, "roles"],
    enabled: !!user?.id,
  });

  const { data: welcomeMessages = {} } = useQuery<Record<string, string>>({
    queryKey: ["/api/welcome-messages"],
  });

  // Get the first role's welcome message (if user has roles)
  const welcomeMessage = userRoles.length > 0 
    ? welcomeMessages[userRoles[0].id] || ""
    : "";

  // Sanitize HTML to prevent XSS
  const sanitizedMessage = welcomeMessage ? DOMPurify.sanitize(welcomeMessage, {
    ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'u', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'span', 'div'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
  }) : "";

  return (
    <div className="bg-background text-foreground min-h-screen">
      <PageHeader title="Dashboard" icon={<Home className="text-primary-foreground" size={16} />} />
      <main className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
        {sanitizedMessage ? (
          <div 
            className="mb-6 p-4 bg-card border border-border rounded-lg"
            dangerouslySetInnerHTML={{ __html: sanitizedMessage }}
            data-testid="text-welcome-message"
          />
        ) : (
          <div className="mb-6">
            <p className="text-muted-foreground" data-testid="text-dashboard-description">
              Welcome to Sirius
            </p>
          </div>
        )}

      <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
        <Card data-testid="card-placeholder-1">
          <CardHeader>
            <CardTitle>Quick Stats</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Coming soon</p>
          </CardContent>
        </Card>

        <Card data-testid="card-placeholder-2">
          <CardHeader>
            <CardTitle>Recent Activity</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Coming soon</p>
          </CardContent>
        </Card>

        <Card data-testid="card-placeholder-3">
          <CardHeader>
            <CardTitle>Quick Actions</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="text-sm text-muted-foreground">Coming soon</p>
          </CardContent>
        </Card>
      </div>
      </main>
    </div>
  );
}

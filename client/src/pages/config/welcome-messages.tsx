import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { Button } from "@/components/ui/button";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { useToast } from "@/hooks/use-toast";
import { MessageSquare, Save, AlertCircle } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { Role } from "@shared/schema";
import DOMPurify from "isomorphic-dompurify";

export default function WelcomeMessagesConfigPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  const { data: roles = [], isLoading: rolesLoading } = useQuery<Role[]>({
    queryKey: ["/api/admin/roles"],
  });

  const { data: welcomeMessages = {}, isLoading: messagesLoading } = useQuery<Record<string, string>>({
    queryKey: ["/api/welcome-messages"],
  });

  const [editedMessages, setEditedMessages] = useState<Record<string, string>>({});
  const [savingRoleId, setSavingRoleId] = useState<string | null>(null);

  useEffect(() => {
    if (welcomeMessages) {
      setEditedMessages(welcomeMessages);
    }
  }, [welcomeMessages]);

  const updateMessageMutation = useMutation({
    mutationFn: async ({ roleId, message }: { roleId: string; message: string }) => {
      return apiRequest("PUT", `/api/welcome-messages/${roleId}`, { message });
    },
    onSuccess: (_, variables) => {
      queryClient.invalidateQueries({ queryKey: ["/api/welcome-messages"] });
      toast({
        title: "Welcome Message Updated",
        description: `Dashboard message for this role has been updated successfully.`,
      });
      setSavingRoleId(null);
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error?.message || "Failed to update welcome message.",
        variant: "destructive",
      });
      setSavingRoleId(null);
    },
  });

  const handleSave = (roleId: string) => {
    setSavingRoleId(roleId);
    updateMessageMutation.mutate({
      roleId,
      message: editedMessages[roleId] || "",
    });
  };

  const handleMessageChange = (roleId: string, value: string) => {
    setEditedMessages((prev) => ({
      ...prev,
      [roleId]: value,
    }));
  };

  const hasChanges = (roleId: string) => {
    return editedMessages[roleId] !== (welcomeMessages[roleId] || "");
  };

  if (rolesLoading || messagesLoading) {
    return (
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            Dashboard Welcome Messages
          </h1>
          <p className="text-muted-foreground mt-2">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Dashboard Welcome Messages
        </h1>
        <p className="text-muted-foreground mt-2">
          Configure custom welcome messages for each role that appear on the dashboard.
          You can use HTML for formatting.
        </p>
      </div>

      <Alert>
        <MessageSquare className="h-4 w-4" />
        <AlertDescription>
          HTML tags are allowed. Use basic formatting like <code>&lt;b&gt;</code>, <code>&lt;i&gt;</code>, 
          <code>&lt;p&gt;</code>, <code>&lt;br&gt;</code>, etc. Advanced JavaScript and style attributes may be filtered for security.
        </AlertDescription>
      </Alert>

      <div className="space-y-4">
        {roles.map((role) => (
          <Card key={role.id} data-testid={`card-welcome-message-${role.id}`}>
            <CardHeader>
              <CardTitle className="flex items-center justify-between">
                <span>{role.name}</span>
                <Button
                  size="sm"
                  onClick={() => handleSave(role.id)}
                  disabled={!hasChanges(role.id) || savingRoleId === role.id}
                  data-testid={`button-save-${role.id}`}
                >
                  <Save className="h-4 w-4 mr-2" />
                  {savingRoleId === role.id ? "Saving..." : "Save"}
                </Button>
              </CardTitle>
              <CardDescription>
                {role.description || "Configure the welcome message for this role"}
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <Label htmlFor={`message-${role.id}`}>Welcome Message (HTML)</Label>
                <Textarea
                  id={`message-${role.id}`}
                  value={editedMessages[role.id] || ""}
                  onChange={(e) => handleMessageChange(role.id, e.target.value)}
                  placeholder="Enter a welcome message for users with this role..."
                  rows={6}
                  className="font-mono text-sm"
                  data-testid={`textarea-message-${role.id}`}
                />
              </div>

              {editedMessages[role.id] && (
                <div>
                  <Label>Preview</Label>
                  <div 
                    className="mt-2 p-4 border rounded-md bg-muted/50"
                    dangerouslySetInnerHTML={{ 
                      __html: DOMPurify.sanitize(editedMessages[role.id], {
                        ALLOWED_TAGS: ['b', 'i', 'em', 'strong', 'u', 'p', 'br', 'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'a', 'span', 'div'],
                        ALLOWED_ATTR: ['href', 'target', 'rel', 'class'],
                      })
                    }}
                    data-testid={`preview-message-${role.id}`}
                  />
                </div>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      {roles.length === 0 && (
        <Alert>
          <AlertCircle className="h-4 w-4" />
          <AlertDescription>
            No roles found. Create roles in User Management to configure welcome messages.
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}

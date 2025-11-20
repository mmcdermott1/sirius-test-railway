import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Save, Mail } from "lucide-react";

interface TrustProviderContactEmailManagementProps {
  trustProviderContactId: string;
  contactEmail: string | null;
}

export default function TrustProviderContactEmailManagement({ trustProviderContactId, contactEmail }: TrustProviderContactEmailManagementProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [editedEmail, setEditedEmail] = useState<string>("");
  const [isEditing, setIsEditing] = useState(false);

  const updateEmailMutation = useMutation({
    mutationFn: async (email: string) => {
      return apiRequest("PATCH", `/api/trust-provider-contacts/${trustProviderContactId}/contact/email`, { email });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trust-provider-contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trust-provider-contacts", trustProviderContactId] });
      queryClient.invalidateQueries({ queryKey: ["/api/trust-providers"] });
      setIsEditing(false);
      toast({
        title: "Success",
        description: "Email updated successfully!",
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to update email. Please try again.";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const handleEdit = () => {
    setEditedEmail(contactEmail || "");
    setIsEditing(true);
  };

  const handleSave = () => {
    const cleanEmail = editedEmail.trim();
    
    if (!cleanEmail) {
      updateEmailMutation.mutate("");
      return;
    }
    
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(cleanEmail)) {
      toast({
        title: "Invalid Email",
        description: "Please enter a valid email address",
        variant: "destructive",
      });
      return;
    }
    
    updateEmailMutation.mutate(cleanEmail);
  };

  const handleCancel = () => {
    setEditedEmail("");
    setIsEditing(false);
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Email Address</CardTitle>
        <CardDescription>Manage contact email address</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!isEditing ? (
          <div className="space-y-4">
            <div className="flex items-center space-x-4 p-4 bg-muted/30 rounded-lg border border-border">
              <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center">
                <Mail size={20} />
              </div>
              <div className="flex-1">
                <Label className="text-sm text-muted-foreground">Email Address</Label>
                <p className="text-lg font-medium text-foreground" data-testid="text-contact-email">
                  {contactEmail || "Not set"}
                </p>
              </div>
              <Button
                onClick={handleEdit}
                variant="outline"
                size="sm"
                data-testid="button-edit-email"
              >
                Edit
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="space-y-2">
              <Label htmlFor="email">Email Address</Label>
              <Input
                id="email"
                type="email"
                value={editedEmail}
                onChange={(e) => setEditedEmail(e.target.value)}
                placeholder="email@example.com"
                autoFocus
                data-testid="input-email"
              />
              <p className="text-xs text-muted-foreground">Enter a valid email address</p>
            </div>
            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={updateEmailMutation.isPending}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={updateEmailMutation.isPending}
                data-testid="button-save"
              >
                {updateEmailMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {updateEmailMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

import { useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { apiRequest } from "@/lib/queryClient";
import { Loader2, Save, User } from "lucide-react";

interface TrustProviderContactNameManagementProps {
  trustProviderContactId: string;
  contactDisplayName: string;
  contactData: {
    title: string | null;
    given: string | null;
    middle: string | null;
    family: string | null;
    generational: string | null;
    credentials: string | null;
  };
}

interface NameComponents {
  title: string;
  given: string;
  middle: string;
  family: string;
  generational: string;
  credentials: string;
}

export default function TrustProviderContactNameManagement({ 
  trustProviderContactId,
  contactDisplayName,
  contactData
}: TrustProviderContactNameManagementProps) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [nameComponents, setNameComponents] = useState<NameComponents>({
    title: "",
    given: "",
    middle: "",
    family: "",
    generational: "",
    credentials: "",
  });
  const [isEditing, setIsEditing] = useState(false);

  const updateNameMutation = useMutation({
    mutationFn: async (components: NameComponents) => {
      return apiRequest("PATCH", `/api/trust-provider-contacts/${trustProviderContactId}/contact/name`, components);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trust-provider-contacts"] });
      queryClient.invalidateQueries({ queryKey: ["/api/trust-provider-contacts", trustProviderContactId] });
      queryClient.invalidateQueries({ queryKey: ["/api/trust-providers"] });
      setIsEditing(false);
      toast({
        title: "Success",
        description: "Name updated successfully!",
      });
    },
    onError: () => {
      toast({
        title: "Error",
        description: "Failed to update name. Please try again.",
        variant: "destructive",
      });
    },
  });

  const handleEdit = () => {
    setNameComponents({
      title: contactData?.title || "",
      given: contactData?.given || "",
      middle: contactData?.middle || "",
      family: contactData?.family || "",
      generational: contactData?.generational || "",
      credentials: contactData?.credentials || "",
    });
    setIsEditing(true);
  };

  const handleSave = () => {
    if (nameComponents.given.trim() || nameComponents.family.trim()) {
      updateNameMutation.mutate(nameComponents);
    }
  };

  const handleCancel = () => {
    setNameComponents({
      title: "",
      given: "",
      middle: "",
      family: "",
      generational: "",
      credentials: "",
    });
    setIsEditing(false);
  };

  const updateField = (field: keyof NameComponents, value: string) => {
    setNameComponents(prev => ({ ...prev, [field]: value }));
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Contact Name</CardTitle>
        <CardDescription>Manage the contact's name</CardDescription>
      </CardHeader>
      <CardContent className="space-y-6">
        {!isEditing ? (
          <div className="space-y-4">
            <div className="flex items-center space-x-4 p-4 bg-muted/30 rounded-lg border border-border">
              <div className="w-12 h-12 bg-primary/10 text-primary rounded-full flex items-center justify-center">
                <User size={20} />
              </div>
              <div className="flex-1">
                <Label className="text-sm text-muted-foreground">Full Name</Label>
                <p className="text-lg font-semibold text-foreground" data-testid="text-contact-name">
                  {contactDisplayName || "No name set"}
                </p>
              </div>
              <Button
                onClick={handleEdit}
                variant="outline"
                size="sm"
                data-testid="button-edit-name"
              >
                Edit
              </Button>
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 gap-4 p-4 bg-muted/10 rounded-lg border border-border/50">
              {[
                { label: "Title", value: contactData?.title },
                { label: "Given Name", value: contactData?.given },
                { label: "Middle Name", value: contactData?.middle },
                { label: "Family Name", value: contactData?.family },
                { label: "Generational", value: contactData?.generational },
                { label: "Credentials", value: contactData?.credentials },
              ].map(({ label, value }) => (
                <div key={label}>
                  <Label className="text-xs text-muted-foreground">{label}</Label>
                  <p className="text-sm text-foreground" data-testid={`text-${label.toLowerCase().replace(" ", "-")}`}>
                    {value || "Not set"}
                  </p>
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label htmlFor="title">Title</Label>
                <Input
                  id="title"
                  value={nameComponents.title}
                  onChange={(e) => updateField("title", e.target.value)}
                  placeholder="Dr., Mr., Ms., etc."
                  data-testid="input-title"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="given">Given Name</Label>
                <Input
                  id="given"
                  value={nameComponents.given}
                  onChange={(e) => updateField("given", e.target.value)}
                  placeholder="John"
                  data-testid="input-given"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="middle">Middle Name</Label>
                <Input
                  id="middle"
                  value={nameComponents.middle}
                  onChange={(e) => updateField("middle", e.target.value)}
                  placeholder="Michael"
                  data-testid="input-middle"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="family">Family Name</Label>
                <Input
                  id="family"
                  value={nameComponents.family}
                  onChange={(e) => updateField("family", e.target.value)}
                  placeholder="Smith"
                  data-testid="input-family"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="generational">Generational Suffix</Label>
                <Input
                  id="generational"
                  value={nameComponents.generational}
                  onChange={(e) => updateField("generational", e.target.value)}
                  placeholder="Jr., Sr., III, etc."
                  data-testid="input-generational"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="credentials">Credentials</Label>
                <Input
                  id="credentials"
                  value={nameComponents.credentials}
                  onChange={(e) => updateField("credentials", e.target.value)}
                  placeholder="MD, PhD, etc."
                  data-testid="input-credentials"
                />
              </div>
            </div>

            <div className="flex justify-end space-x-2">
              <Button
                variant="outline"
                onClick={handleCancel}
                disabled={updateNameMutation.isPending}
                data-testid="button-cancel"
              >
                Cancel
              </Button>
              <Button
                onClick={handleSave}
                disabled={updateNameMutation.isPending}
                data-testid="button-save"
              >
                {updateNameMutation.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
                {updateNameMutation.isPending ? "Saving..." : "Save Changes"}
              </Button>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}

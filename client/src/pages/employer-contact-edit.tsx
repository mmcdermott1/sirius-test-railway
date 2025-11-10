import { useParams, useLocation } from "wouter";
import { useQuery, useMutation } from "@tanstack/react-query";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useEffect } from "react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { ArrowLeft } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { queryClient, apiRequest } from "@/lib/queryClient";
import type { EmployerContactType } from "@shared/schema";

interface EmployerContactDetail {
  id: string;
  employerId: string;
  contactId: string;
  contactTypeId: string | null;
  contact: {
    id: string;
    displayName: string;
    email: string | null;
  };
  contactType?: {
    id: string;
    name: string;
    description: string | null;
  } | null;
}

const updateContactTypeSchema = z.object({
  contactTypeId: z.string().nullable(),
});

type UpdateContactTypeFormData = z.infer<typeof updateContactTypeSchema>;

export default function EmployerContactEditPage() {
  const { id } = useParams<{ id: string }>();
  const [, navigate] = useLocation();
  const { toast } = useToast();

  const { data: employerContact, isLoading: contactLoading } = useQuery<EmployerContactDetail>({
    queryKey: [`/api/employer-contacts/${id}`],
  });

  const { data: contactTypes } = useQuery<EmployerContactType[]>({
    queryKey: ["/api/employer-contact-types"],
  });

  const form = useForm<UpdateContactTypeFormData>({
    resolver: zodResolver(updateContactTypeSchema),
    defaultValues: {
      contactTypeId: null,
    },
  });

  // Update form when data loads
  useEffect(() => {
    if (employerContact) {
      form.reset({
        contactTypeId: employerContact.contactTypeId || null,
      });
    }
  }, [employerContact, form]);

  const updateMutation = useMutation({
    mutationFn: async (data: UpdateContactTypeFormData) => {
      // Normalize "null" string to actual null
      const normalizedData = {
        contactTypeId: data.contactTypeId === "null" ? null : data.contactTypeId,
      };
      return await apiRequest("PATCH", `/api/employer-contacts/${id}`, normalizedData);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: [`/api/employer-contacts/${id}`] });
      if (employerContact?.employerId) {
        queryClient.invalidateQueries({ queryKey: ["/api/employers", employerContact.employerId, "contacts"] });
        queryClient.invalidateQueries({ queryKey: ["/api/employers", employerContact.employerId] });
      }
      toast({
        title: "Success",
        description: "Contact type updated successfully",
      });
      navigate(`/employers/${employerContact?.employerId}`);
    },
    onError: (error: any) => {
      toast({
        title: "Error",
        description: error.message || "Failed to update contact type",
        variant: "destructive",
      });
    },
  });

  const onSubmit = (data: UpdateContactTypeFormData) => {
    updateMutation.mutate(data);
  };

  if (contactLoading) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Skeleton className="h-10 w-64 mb-6" />
        <Card>
          <CardHeader>
            <Skeleton className="h-8 w-48" />
            <Skeleton className="h-4 w-96 mt-2" />
          </CardHeader>
          <CardContent>
            <Skeleton className="h-64 w-full" />
          </CardContent>
        </Card>
      </div>
    );
  }

  if (!employerContact) {
    return (
      <div className="max-w-4xl mx-auto p-6">
        <Card>
          <CardContent className="pt-6">
            <div className="text-center text-muted-foreground">
              Employer contact not found
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="max-w-4xl mx-auto p-6">
      <Button
        variant="ghost"
        onClick={() => navigate(`/employers/${employerContact.employerId}`)}
        className="mb-6"
        data-testid="button-back"
      >
        <ArrowLeft size={16} className="mr-2" />
        Back to Employer
      </Button>

      <Card>
        <CardHeader>
          <CardTitle>Edit Employer Contact</CardTitle>
          <CardDescription>
            Update the contact type for {employerContact.contact.displayName}
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="mb-6 p-4 bg-muted/30 rounded-lg">
            <div className="text-sm font-medium mb-1">Contact Information</div>
            <div className="text-sm text-muted-foreground">
              <div>Name: {employerContact.contact.displayName}</div>
              {employerContact.contact.email && (
                <div>Email: {employerContact.contact.email}</div>
              )}
            </div>
          </div>

          <Form {...form}>
            <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-6">
              <FormField
                control={form.control}
                name="contactTypeId"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Contact Type</FormLabel>
                    <Select 
                      onValueChange={field.onChange} 
                      value={field.value || undefined}
                    >
                      <FormControl>
                        <SelectTrigger data-testid="select-contact-type">
                          <SelectValue placeholder="Select contact type (optional)" />
                        </SelectTrigger>
                      </FormControl>
                      <SelectContent>
                        <SelectItem value="null">None</SelectItem>
                        {contactTypes?.map((type) => (
                          <SelectItem key={type.id} value={type.id}>
                            {type.name}
                          </SelectItem>
                        ))}
                      </SelectContent>
                    </Select>
                    <FormMessage />
                  </FormItem>
                )}
              />

              <div className="flex items-center space-x-2">
                <Button
                  type="submit"
                  disabled={updateMutation.isPending}
                  data-testid="button-save"
                >
                  {updateMutation.isPending ? "Saving..." : "Save Changes"}
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => navigate(`/employers/${employerContact.employerId}`)}
                  disabled={updateMutation.isPending}
                  data-testid="button-cancel"
                >
                  Cancel
                </Button>
              </div>
            </form>
          </Form>
        </CardContent>
      </Card>
    </div>
  );
}

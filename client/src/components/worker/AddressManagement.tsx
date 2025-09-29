import { useState, useEffect, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { PostalAddress, InsertPostalAddress, insertPostalAddressSchema } from "@shared/schema";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogTrigger } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { useToast } from "@/hooks/use-toast";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { Form, FormControl, FormField, FormItem, FormLabel, FormMessage } from "@/components/ui/form";
import { Switch } from "@/components/ui/switch";
import { Plus, Edit, Trash2, MapPin, Star } from "lucide-react";
import { apiRequest } from "@/lib/queryClient";
import { useAddressValidation } from "@/hooks/useAddressValidation";
import { AddressValidationDisplay } from "@/components/ui/address-validation";

interface AddressManagementProps {
  workerId: string;
  contactId: string;
}

interface AddressFormData extends Omit<InsertPostalAddress, 'contactId'> {}

export default function AddressManagement({ workerId, contactId }: AddressManagementProps) {
  const [isAddDialogOpen, setIsAddDialogOpen] = useState(false);
  const [editingAddress, setEditingAddress] = useState<PostalAddress | null>(null);
  const { toast } = useToast();
  const queryClient = useQueryClient();
  
  // Address validation hooks for add and edit forms
  const addValidation = useAddressValidation();
  const editValidation = useAddressValidation();

  // Fetch addresses for this contact
  const { data: addresses = [], isLoading, error } = useQuery<PostalAddress[]>({
    queryKey: ["/api/contacts", contactId, "addresses"],
    queryFn: async () => {
      const response = await fetch(`/api/contacts/${contactId}/addresses`);
      if (!response.ok) {
        throw new Error("Failed to fetch addresses");
      }
      return response.json();
    },
  });

  // Add address mutation
  const addAddressMutation = useMutation({
    mutationFn: async (data: AddressFormData) => {
      return apiRequest("POST", `/api/contacts/${contactId}/addresses`, data);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "addresses"] });
      setIsAddDialogOpen(false);
      toast({
        title: "Success",
        description: "Address added successfully",
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to add address";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Update address mutation
  const updateAddressMutation = useMutation({
    mutationFn: async (data: { id: string; updates: Partial<AddressFormData> }) => {
      return apiRequest("PUT", `/api/addresses/${data.id}`, data.updates);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "addresses"] });
      setEditingAddress(null);
      toast({
        title: "Success",
        description: "Address updated successfully",
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to update address";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Delete address mutation
  const deleteAddressMutation = useMutation({
    mutationFn: async (addressId: string) => {
      return apiRequest("DELETE", `/api/addresses/${addressId}`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "addresses"] });
      toast({
        title: "Success",
        description: "Address deleted successfully",
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to delete address";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  // Set primary address mutation
  const setPrimaryMutation = useMutation({
    mutationFn: async (addressId: string) => {
      return apiRequest("PUT", `/api/addresses/${addressId}/set-primary`);
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/contacts", contactId, "addresses"] });
      toast({
        title: "Success",
        description: "Primary address updated successfully",
      });
    },
    onError: (error: any) => {
      const errorMessage = error?.message || "Failed to set primary address";
      toast({
        title: "Error",
        description: errorMessage,
        variant: "destructive",
      });
    },
  });

  const addressFormSchema = insertPostalAddressSchema.omit({ contactId: true });

  // Form for adding addresses
  const addForm = useForm<AddressFormData>({
    resolver: zodResolver(addressFormSchema),
    defaultValues: {
      street: "",
      city: "",
      state: "",
      postalCode: "",
      country: "",
      isPrimary: false,
      isActive: true,
    },
  });

  // Form for editing addresses
  const editForm = useForm<AddressFormData>({
    resolver: zodResolver(addressFormSchema),
  });

  // Watch form values for validation
  const addFormValues = addForm.watch();
  const editFormValues = editForm.watch();
  
  // Track last validated snapshots to prevent unnecessary validation
  const lastAddValidationRef = useRef<string>("");
  const lastEditValidationRef = useRef<string>("");

  // Trigger debounced validation when form values actually change
  useEffect(() => {
    const currentSnapshot = JSON.stringify(addFormValues);
    if (currentSnapshot !== lastAddValidationRef.current) {
      lastAddValidationRef.current = currentSnapshot;
      addValidation.validateAddressDebounced(addFormValues);
    }
  }, [addFormValues, addValidation.validateAddressDebounced]);

  useEffect(() => {
    const currentSnapshot = JSON.stringify(editFormValues);
    if (currentSnapshot !== lastEditValidationRef.current) {
      lastEditValidationRef.current = currentSnapshot;
      editValidation.validateAddressDebounced(editFormValues);
    }
  }, [editFormValues, editValidation.validateAddressDebounced]);

  // Handle applying validation suggestions
  const handleApplyAddSuggestion = (field: string, value: string) => {
    addForm.setValue(field as keyof AddressFormData, value);
  };

  const handleApplyEditSuggestion = (field: string, value: string) => {
    editForm.setValue(field as keyof AddressFormData, value);
  };

  const onAddSubmit = (data: AddressFormData) => {
    // Block submission if validation is in progress
    if (addValidation.isValidating) {
      toast({
        title: "Validation in Progress",
        description: "Please wait while we validate the address...",
      });
      return;
    }

    // Check if we have a valid result that matches current data
    if (!addValidation.isAddressValidForSaving(data)) {
      // If we have a validation result but it doesn't match current data, or it's invalid
      if (addValidation.hasValidationResult) {
        toast({
          title: "Invalid Address",
          description: "Please fix the address validation errors before saving.",
          variant: "destructive",
        });
      } else {
        // No validation result yet, trigger validation
        addValidation.validateAddress(data);
        toast({
          title: "Validating Address",
          description: "Please wait while we validate the address...",
        });
      }
      return;
    }

    // Address is valid and matches validated snapshot, proceed with submission
    addAddressMutation.mutate(data);
  };

  const onEditSubmit = (data: AddressFormData) => {
    if (editingAddress) {
      // Block submission if validation is in progress
      if (editValidation.isValidating) {
        toast({
          title: "Validation in Progress",
          description: "Please wait while we validate the address...",
        });
        return;
      }

      // Check if we have a valid result that matches current data
      if (!editValidation.isAddressValidForSaving(data)) {
        // If we have a validation result but it doesn't match current data, or it's invalid
        if (editValidation.hasValidationResult) {
          toast({
            title: "Invalid Address",
            description: "Please fix the address validation errors before saving.",
            variant: "destructive",
          });
        } else {
          // No validation result yet, trigger validation
          editValidation.validateAddress(data);
          toast({
            title: "Validating Address",
            description: "Please wait while we validate the address...",
          });
        }
        return;
      }

      // Address is valid and matches validated snapshot, proceed with submission
      updateAddressMutation.mutate({
        id: editingAddress.id,
        updates: data,
      });
    }
  };

  const handleEdit = (address: PostalAddress) => {
    setEditingAddress(address);
    editForm.reset({
      street: address.street,
      city: address.city,
      state: address.state,
      postalCode: address.postalCode,
      country: address.country,
      isPrimary: address.isPrimary,
      isActive: address.isActive,
    });
  };

  const handleDelete = (addressId: string) => {
    if (confirm("Are you sure you want to delete this address?")) {
      deleteAddressMutation.mutate(addressId);
    }
  };

  const handleSetPrimary = (addressId: string) => {
    setPrimaryMutation.mutate(addressId);
  };

  if (isLoading) {
    return (
      <div className="space-y-4">
        <Skeleton className="h-8 w-48" />
        <Skeleton className="h-32 w-full" />
        <Skeleton className="h-32 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="text-center py-8">
        <p className="text-destructive">Failed to load addresses</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h3 className="text-lg font-semibold text-foreground">Postal Addresses</h3>
        <Dialog open={isAddDialogOpen} onOpenChange={setIsAddDialogOpen}>
          <DialogTrigger asChild>
            <Button data-testid="button-add-address">
              <Plus size={16} className="mr-2" />
              Add Address
            </Button>
          </DialogTrigger>
          <DialogContent className="sm:max-w-md">
            <DialogHeader>
              <DialogTitle>Add New Address</DialogTitle>
            </DialogHeader>
            <Form {...addForm}>
              <form onSubmit={addForm.handleSubmit(onAddSubmit)} className="space-y-4">
                <FormField
                  control={addForm.control}
                  name="street"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Street Address</FormLabel>
                      <FormControl>
                        <Input placeholder="123 Main St" data-testid="input-street" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={addForm.control}
                    name="city"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>City</FormLabel>
                        <FormControl>
                          <Input placeholder="New York" data-testid="input-city" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={addForm.control}
                    name="state"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>State</FormLabel>
                        <FormControl>
                          <Input placeholder="NY" data-testid="input-state" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="grid grid-cols-2 gap-4">
                  <FormField
                    control={addForm.control}
                    name="postalCode"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Postal Code</FormLabel>
                        <FormControl>
                          <Input placeholder="10001" data-testid="input-postal-code" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={addForm.control}
                    name="country"
                    render={({ field }) => (
                      <FormItem>
                        <FormLabel>Country</FormLabel>
                        <FormControl>
                          <Input placeholder="United States" data-testid="input-country" {...field} />
                        </FormControl>
                        <FormMessage />
                      </FormItem>
                    )}
                  />
                </div>
                <div className="flex items-center justify-between">
                  <FormField
                    control={addForm.control}
                    name="isPrimary"
                    render={({ field }) => (
                      <FormItem className="flex items-center space-x-2">
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-is-primary"
                          />
                        </FormControl>
                        <FormLabel>Primary address</FormLabel>
                      </FormItem>
                    )}
                  />
                  <FormField
                    control={addForm.control}
                    name="isActive"
                    render={({ field }) => (
                      <FormItem className="flex items-center space-x-2">
                        <FormControl>
                          <Switch
                            checked={field.value}
                            onCheckedChange={field.onChange}
                            data-testid="switch-is-active"
                          />
                        </FormControl>
                        <FormLabel>Active</FormLabel>
                      </FormItem>
                    )}
                  />
                </div>
                
                {/* Address Validation Display */}
                <AddressValidationDisplay
                  validationResult={addValidation.validationResult}
                  isValidating={addValidation.isValidating}
                  onApplySuggestion={handleApplyAddSuggestion}
                  className="my-4"
                />
                
                <div className="flex justify-end space-x-2">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => setIsAddDialogOpen(false)}
                    data-testid="button-cancel-add"
                  >
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={addAddressMutation.isPending}
                    data-testid="button-save-address"
                  >
                    {addAddressMutation.isPending ? "Adding..." : "Add Address"}
                  </Button>
                </div>
              </form>
            </Form>
          </DialogContent>
        </Dialog>
      </div>

      {addresses.length === 0 ? (
        <Card>
          <CardContent className="flex flex-col items-center justify-center py-12">
            <MapPin className="text-muted-foreground mb-4" size={48} />
            <h3 className="text-lg font-medium text-foreground mb-2">No addresses yet</h3>
            <p className="text-muted-foreground text-center mb-4">
              Add the first postal address for this worker
            </p>
            <Button onClick={() => setIsAddDialogOpen(true)} data-testid="button-add-first-address">
              <Plus size={16} className="mr-2" />
              Add Address
            </Button>
          </CardContent>
        </Card>
      ) : (
        <div className="space-y-4">
          {addresses.map((address) => (
            <Card key={address.id} className="relative">
              <CardHeader className="pb-2">
                <div className="flex items-start justify-between">
                  <div className="flex items-center space-x-2">
                    <CardTitle className="text-base">{address.street}</CardTitle>
                    {address.isPrimary && (
                      <Badge variant="default" className="flex items-center space-x-1">
                        <Star size={12} />
                        <span>Primary</span>
                      </Badge>
                    )}
                    {!address.isActive && (
                      <Badge variant="secondary">Inactive</Badge>
                    )}
                  </div>
                  <div className="flex items-center space-x-2">
                    {!address.isPrimary && (
                      <Button
                        variant="ghost"
                        size="sm"
                        onClick={() => handleSetPrimary(address.id)}
                        disabled={setPrimaryMutation.isPending}
                        data-testid={`button-set-primary-${address.id}`}
                      >
                        <Star size={14} />
                      </Button>
                    )}
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleEdit(address)}
                      data-testid={`button-edit-address-${address.id}`}
                    >
                      <Edit size={14} />
                    </Button>
                    <Button
                      variant="ghost"
                      size="sm"
                      onClick={() => handleDelete(address.id)}
                      disabled={deleteAddressMutation.isPending}
                      data-testid={`button-delete-address-${address.id}`}
                    >
                      <Trash2 size={14} className="text-destructive" />
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent>
                <p className="text-muted-foreground">
                  {address.city}, {address.state} {address.postalCode}
                </p>
                <p className="text-muted-foreground text-sm">{address.country}</p>
              </CardContent>
            </Card>
          ))}
        </div>
      )}

      {/* Edit Address Dialog */}
      <Dialog open={editingAddress !== null} onOpenChange={() => setEditingAddress(null)}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Address</DialogTitle>
          </DialogHeader>
          <Form {...editForm}>
            <form onSubmit={editForm.handleSubmit(onEditSubmit)} className="space-y-4">
              <FormField
                control={editForm.control}
                name="street"
                render={({ field }) => (
                  <FormItem>
                    <FormLabel>Street Address</FormLabel>
                    <FormControl>
                      <Input placeholder="123 Main St" data-testid="input-edit-street" {...field} />
                    </FormControl>
                    <FormMessage />
                  </FormItem>
                )}
              />
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editForm.control}
                  name="city"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>City</FormLabel>
                      <FormControl>
                        <Input placeholder="New York" data-testid="input-edit-city" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="state"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>State</FormLabel>
                      <FormControl>
                        <Input placeholder="NY" data-testid="input-edit-state" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <FormField
                  control={editForm.control}
                  name="postalCode"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Postal Code</FormLabel>
                      <FormControl>
                        <Input placeholder="10001" data-testid="input-edit-postal-code" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="country"
                  render={({ field }) => (
                    <FormItem>
                      <FormLabel>Country</FormLabel>
                      <FormControl>
                        <Input placeholder="United States" data-testid="input-edit-country" {...field} />
                      </FormControl>
                      <FormMessage />
                    </FormItem>
                  )}
                />
              </div>
              <div className="flex items-center justify-between">
                <FormField
                  control={editForm.control}
                  name="isPrimary"
                  render={({ field }) => (
                    <FormItem className="flex items-center space-x-2">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="switch-edit-is-primary"
                        />
                      </FormControl>
                      <FormLabel>Primary address</FormLabel>
                    </FormItem>
                  )}
                />
                <FormField
                  control={editForm.control}
                  name="isActive"
                  render={({ field }) => (
                    <FormItem className="flex items-center space-x-2">
                      <FormControl>
                        <Switch
                          checked={field.value}
                          onCheckedChange={field.onChange}
                          data-testid="switch-edit-is-active"
                        />
                      </FormControl>
                      <FormLabel>Active</FormLabel>
                    </FormItem>
                  )}
                />
              </div>
              
              {/* Address Validation Display */}
              <AddressValidationDisplay
                validationResult={editValidation.validationResult}
                isValidating={editValidation.isValidating}
                onApplySuggestion={handleApplyEditSuggestion}
                className="my-4"
              />
              
              <div className="flex justify-end space-x-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => setEditingAddress(null)}
                  data-testid="button-cancel-edit"
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  disabled={updateAddressMutation.isPending}
                  data-testid="button-update-address"
                >
                  {updateAddressMutation.isPending ? "Updating..." : "Update Address"}
                </Button>
              </div>
            </form>
          </Form>
        </DialogContent>
      </Dialog>
    </div>
  );
}
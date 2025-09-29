import { useState, useEffect } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Label } from "@/components/ui/label";
import { MapPin, Globe, AlertCircle, CheckCircle } from "lucide-react";
import { useToast } from "@/hooks/use-toast";
import { Skeleton } from "@/components/ui/skeleton";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import {
  useAddressValidationConfig,
  AddressValidationConfig,
} from "@/hooks/useAddressValidationConfig";
import { apiRequest } from "@/lib/queryClient";

export default function PostalAddressesConfigPage() {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const { data: config, isLoading, error } = useAddressValidationConfig();
  const [isLocalMode, setIsLocalMode] = useState<boolean>(true);

  // Initialize local state when config loads
  useEffect(() => {
    if (config) {
      setIsLocalMode(config.mode === "local");
    }
  }, [config]);

  const updateConfigMutation = useMutation({
    mutationFn: async (newMode: "local" | "google") => {
      const updatedConfig: AddressValidationConfig = {
        mode: newMode,
        local: {
          ...config?.local,
          enabled: newMode === "local",
        },
        google: {
          ...config?.google,
          enabled: newMode === "google",
        },
      };

      return apiRequest(
        "PUT",
        "/api/variables/address_validation_config",
        updatedConfig,
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({
        queryKey: ["/api/variables/address_validation_config"],
      });
      toast({
        title: "Configuration Updated",
        description: `Address validation mode changed to ${isLocalMode ? "Local" : "Google Places"}.`,
      });
    },
    onError: (error: any) => {
      toast({
        title: "Update Failed",
        description: error?.message || "Failed to update configuration.",
        variant: "destructive",
      });
      // Revert local state on error
      setIsLocalMode(config?.mode === "local" ?? true);
    },
  });

  const handleModeChange = (checked: boolean) => {
    const newMode = checked ? "google" : "local";
    setIsLocalMode(!checked);
    updateConfigMutation.mutate(newMode);
  };

  if (isLoading) {
    return (
      <div className="space-y-6">
        <div>
          <Skeleton className="h-8 w-64" />
          <Skeleton className="h-4 w-96 mt-2" />
        </div>
        <Skeleton className="h-64 w-full" />
      </div>
    );
  }

  if (error) {
    return (
      <Alert variant="destructive">
        <AlertCircle className="h-4 w-4" />
        <AlertTitle>Error</AlertTitle>
        <AlertDescription>
          Failed to load address validation configuration. Please try refreshing
          the page.
        </AlertDescription>
      </Alert>
    );
  }

  const currentMode = config?.mode || "local";
  const isGoogleMode = currentMode === "google";

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
          Postal Addresses Configuration
        </h1>
        <p className="text-muted-foreground mt-2">
          Configure how address validation works throughout the system
        </p>
      </div>

      {/* Current Status */}
      <Alert>
        <CheckCircle className="h-4 w-4" />
        <AlertTitle>Current Mode</AlertTitle>
        <AlertDescription>
          Address validation is currently using{" "}
          <strong>{isGoogleMode ? "Google Places" : "Local"}</strong> mode.
        </AlertDescription>
      </Alert>

      {/* Configuration Card */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <MapPin className="h-5 w-5" />
            Validation Mode
          </CardTitle>
          <CardDescription>
            Choose between local pattern validation or Google Places
            autocomplete
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {/* Mode Toggle */}
          <div className="flex items-center justify-between p-4 border rounded-lg">
            <div className="space-y-1">
              <Label
                htmlFor="validation-mode"
                className="text-base font-medium"
              >
                Use Google Places Autocomplete
              </Label>
              <p className="text-sm text-muted-foreground">
                Enable Google Places for real-time address suggestions and
                validation
              </p>
            </div>
            <Switch
              id="validation-mode"
              checked={isGoogleMode}
              onCheckedChange={handleModeChange}
              disabled={updateConfigMutation.isPending}
              data-testid="switch-validation-mode"
            />
          </div>

          {/* Save Status */}
          {updateConfigMutation.isPending && (
            <Alert>
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>Updating configuration...</AlertDescription>
            </Alert>
          )}
        </CardContent>
      </Card>
    </div>
  );
}

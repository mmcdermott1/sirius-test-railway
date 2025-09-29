import { AlertCircle, CheckCircle, Loader2, Lightbulb } from "lucide-react";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import type { AddressValidationResult } from "@/hooks/useAddressValidation";

interface AddressValidationDisplayProps {
  validationResult: AddressValidationResult | null;
  isValidating: boolean;
  onApplySuggestion?: (field: string, value: string) => void;
  className?: string;
}

export function AddressValidationDisplay({
  validationResult,
  isValidating,
  onApplySuggestion,
  className = "",
}: AddressValidationDisplayProps) {
  if (isValidating) {
    return (
      <Alert className={className}>
        <Loader2 className="h-4 w-4 animate-spin" />
        <AlertDescription>Validating address...</AlertDescription>
      </Alert>
    );
  }

  if (!validationResult) {
    return null;
  }

  const { isValid, errors, warnings, suggestions, source } = validationResult;

  return (
    <div className={`space-y-3 ${className}`}>
      {/* Validation Status */}
      <Alert variant={isValid ? "default" : "destructive"}>
        {isValid ? (
          <CheckCircle className="h-4 w-4" />
        ) : (
          <AlertCircle className="h-4 w-4" />
        )}
        <AlertDescription className="flex items-center justify-between">
          <span>
            {isValid ? "Address is valid" : "Address validation failed"}
          </span>
          <Badge variant="outline" className="text-xs">
            {source === "local" ? "Local" : "Google Maps"}
          </Badge>
        </AlertDescription>
      </Alert>

      {/* Errors */}
      {errors.length > 0 && (
        <div className="space-y-2">
          {errors.map((error, index) => (
            <Alert key={index} variant="destructive">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* Warnings */}
      {warnings.length > 0 && (
        <div className="space-y-2">
          {warnings.map((warning, index) => (
            <Alert key={index} variant="default" className="border-yellow-200 bg-yellow-50 text-yellow-800">
              <AlertCircle className="h-4 w-4" />
              <AlertDescription>{warning}</AlertDescription>
            </Alert>
          ))}
        </div>
      )}

      {/* Suggestions */}
      {suggestions && Object.keys(suggestions).length > 0 && (
        <Alert variant="default" className="border-blue-200 bg-blue-50">
          <Lightbulb className="h-4 w-4 text-blue-600" />
          <AlertDescription>
            <div className="space-y-2">
              <p className="font-medium text-blue-900">Suggestions:</p>
              <div className="space-y-2">
                {Object.entries(suggestions).map(([field, value]) => (
                  <div key={field} className="flex items-center justify-between">
                    <span className="text-sm text-blue-800">
                      {field.charAt(0).toUpperCase() + field.slice(1)}: {value}
                    </span>
                    {onApplySuggestion && (
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() => onApplySuggestion(field, value)}
                        className="h-6 px-2 text-xs"
                        data-testid={`button-apply-suggestion-${field}`}
                      >
                        Apply
                      </Button>
                    )}
                  </div>
                ))}
              </div>
            </div>
          </AlertDescription>
        </Alert>
      )}
    </div>
  );
}
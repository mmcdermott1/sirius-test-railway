import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { apiRequest } from "@/lib/queryClient";

export interface AddressInput {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

export interface AddressValidationResult {
  isValid: boolean;
  errors: string[];
  warnings: string[];
  suggestions?: {
    street?: string;
    city?: string;
    state?: string;
    postalCode?: string;
    country?: string;
  };
  source: "local" | "google";
}

export function useAddressValidation() {
  const [lastValidationResult, setLastValidationResult] = useState<AddressValidationResult | null>(null);

  const validateMutation = useMutation({
    mutationFn: async (address: AddressInput): Promise<AddressValidationResult> => {
      return await apiRequest("POST", "/api/addresses/validate", address) as AddressValidationResult;
    },
    onSuccess: (result) => {
      setLastValidationResult(result);
    },
    onError: (error) => {
      console.error("Address validation failed:", error);
      setLastValidationResult({
        isValid: false,
        errors: ["Validation service temporarily unavailable"],
        warnings: [],
        source: "local",
      });
    },
  });

  const validateAddress = (address: AddressInput) => {
    // Only validate if all required fields are present
    if (address.street && address.city && address.state && address.postalCode && address.country) {
      validateMutation.mutate(address);
    } else {
      setLastValidationResult(null);
    }
  };

  const clearValidation = () => {
    setLastValidationResult(null);
  };

  return {
    validateAddress,
    clearValidation,
    isValidating: validateMutation.isPending,
    validationResult: lastValidationResult,
    hasValidationResult: lastValidationResult !== null,
  };
}
import { storage } from "../storage";

// Address validation configuration interface
export interface AddressValidationConfig {
  mode: "local" | "google";
  local: {
    enabled: boolean;
    countries: string[];
    strictValidation: boolean;
  };
  google: {
    enabled: boolean;
    apiKeyName: string;
    components: {
      country: boolean;
      administrative_area_level_1: boolean;
      postal_code: boolean;
    };
  };
  fallback: {
    useLocalOnGoogleFailure: boolean;
    logValidationAttempts: boolean;
  };
}

// Default configuration
const DEFAULT_CONFIG: AddressValidationConfig = {
  mode: "local",
  local: {
    enabled: true,
    countries: ["US"],
    strictValidation: true,
  },
  google: {
    enabled: false,
    apiKeyName: "GOOGLE_MAPS_API_KEY",
    components: {
      country: true,
      administrative_area_level_1: true,
      postal_code: true,
    },
  },
  fallback: {
    useLocalOnGoogleFailure: true,
    logValidationAttempts: true,
  },
};

// US States validation data
const US_STATES = {
  "AL": "Alabama", "AK": "Alaska", "AZ": "Arizona", "AR": "Arkansas", "CA": "California",
  "CO": "Colorado", "CT": "Connecticut", "DE": "Delaware", "FL": "Florida", "GA": "Georgia",
  "HI": "Hawaii", "ID": "Idaho", "IL": "Illinois", "IN": "Indiana", "IA": "Iowa",
  "KS": "Kansas", "KY": "Kentucky", "LA": "Louisiana", "ME": "Maine", "MD": "Maryland",
  "MA": "Massachusetts", "MI": "Michigan", "MN": "Minnesota", "MS": "Mississippi", "MO": "Missouri",
  "MT": "Montana", "NE": "Nebraska", "NV": "Nevada", "NH": "New Hampshire", "NJ": "New Jersey",
  "NM": "New Mexico", "NY": "New York", "NC": "North Carolina", "ND": "North Dakota", "OH": "Ohio",
  "OK": "Oklahoma", "OR": "Oregon", "PA": "Pennsylvania", "RI": "Rhode Island", "SC": "South Carolina",
  "SD": "South Dakota", "TN": "Tennessee", "TX": "Texas", "UT": "Utah", "VT": "Vermont",
  "VA": "Virginia", "WA": "Washington", "WV": "West Virginia", "WI": "Wisconsin", "WY": "Wyoming",
  "DC": "District of Columbia"
};

// Address validation result interface
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

// Address input interface
export interface AddressInput {
  street: string;
  city: string;
  state: string;
  postalCode: string;
  country: string;
}

class AddressValidationService {
  private config: AddressValidationConfig | null = null;

  async getConfig(): Promise<AddressValidationConfig> {
    if (!this.config) {
      await this.loadConfig();
    }
    return this.config!;
  }

  private async loadConfig(): Promise<void> {
    try {
      const configVar = await storage.getVariableByName("address_validation_config");
      if (configVar) {
        this.config = configVar.value as AddressValidationConfig;
      } else {
        // Create default configuration if it doesn't exist
        await this.initializeConfig();
      }
    } catch (error) {
      console.error("Failed to load address validation config:", error);
      this.config = DEFAULT_CONFIG;
    }
  }

  private async initializeConfig(): Promise<void> {
    try {
      await storage.createVariable({
        name: "address_validation_config",
        value: DEFAULT_CONFIG,
      });
      this.config = DEFAULT_CONFIG;
      console.log("Address validation configuration initialized with default settings");
    } catch (error) {
      console.error("Failed to initialize address validation config:", error);
      this.config = DEFAULT_CONFIG;
    }
  }

  async validateAddress(address: AddressInput): Promise<AddressValidationResult> {
    const config = await this.getConfig();

    if (config.mode === "google" && config.google.enabled) {
      try {
        return await this.validateWithGoogle(address);
      } catch (error) {
        console.error("Google validation failed:", error);
        if (config.fallback.useLocalOnGoogleFailure) {
          console.log("Falling back to local validation");
          return await this.validateLocally(address);
        }
        return {
          isValid: false,
          errors: ["Address validation service temporarily unavailable"],
          warnings: [],
          source: "google",
        };
      }
    }

    return await this.validateLocally(address);
  }

  private async validateLocally(address: AddressInput): Promise<AddressValidationResult> {
    const config = await this.getConfig();
    const errors: string[] = [];
    const warnings: string[] = [];
    const suggestions: any = {};

    // Validate country
    if (!config.local.countries.includes(address.country.toUpperCase())) {
      if (config.local.strictValidation) {
        errors.push(`Country "${address.country}" is not supported for validation`);
      } else {
        warnings.push(`Country "${address.country}" validation not available`);
      }
    }

    // US-specific validation
    if (address.country.toUpperCase() === "US") {
      // Validate state
      const stateCode = address.state.toUpperCase();
      if (!US_STATES[stateCode as keyof typeof US_STATES]) {
        errors.push("Invalid state code. Please use 2-letter state abbreviation (e.g., CA, NY, TX)");
      } else {
        // Suggest full state name if abbreviation is correct
        suggestions.state = US_STATES[stateCode as keyof typeof US_STATES];
      }

      // Validate postal code
      const zipRegex = /^\d{5}(-\d{4})?$/;
      if (!zipRegex.test(address.postalCode)) {
        errors.push("Invalid postal code format. Use 5 digits (12345) or 9 digits (12345-6789)");
      } else {
        // Normalize to 5-digit format if needed
        const normalizedZip = address.postalCode.split("-")[0];
        if (normalizedZip !== address.postalCode) {
          suggestions.postalCode = normalizedZip;
        }
      }
    }

    // Basic field validation
    if (!address.street.trim()) {
      errors.push("Street address is required");
    }
    if (!address.city.trim()) {
      errors.push("City is required");
    }
    if (!address.state.trim()) {
      errors.push("State is required");
    }
    if (!address.postalCode.trim()) {
      errors.push("Postal code is required");
    }
    if (!address.country.trim()) {
      errors.push("Country is required");
    }

    // Street address basic validation
    if (address.street.trim() && !/\d/.test(address.street)) {
      warnings.push("Street address typically includes a number");
    }

    return {
      isValid: errors.length === 0,
      errors,
      warnings,
      suggestions: Object.keys(suggestions).length > 0 ? suggestions : undefined,
      source: "local",
    };
  }

  private async validateWithGoogle(address: AddressInput): Promise<AddressValidationResult> {
    // TODO: Implement Google Maps validation
    // For now, throw an error to trigger fallback
    throw new Error("Google Maps validation not yet implemented");
  }

  async updateConfig(newConfig: Partial<AddressValidationConfig>): Promise<void> {
    const currentConfig = await this.getConfig();
    const updatedConfig = { ...currentConfig, ...newConfig };
    
    const configVar = await storage.getVariableByName("address_validation_config");
    if (configVar) {
      await storage.updateVariable(configVar.id, {
        value: updatedConfig,
      });
    } else {
      await storage.createVariable({
        name: "address_validation_config",
        value: updatedConfig,
      });
    }
    
    this.config = updatedConfig;
  }
}

export const addressValidationService = new AddressValidationService();
import { parsePhoneNumber, CountryCode, PhoneNumber } from 'libphonenumber-js';

export interface PhoneValidationResult {
  isValid: boolean;
  e164Format?: string;
  nationalFormat?: string;
  internationalFormat?: string;
  country?: string;
  type?: string;
  error?: string;
}

export class PhoneValidationService {
  private defaultCountry: CountryCode = 'US';

  constructor(defaultCountry: CountryCode = 'US') {
    this.defaultCountry = defaultCountry;
  }

  validateAndFormat(phoneNumberInput: string, country?: CountryCode): PhoneValidationResult {
    try {
      const countryCode = country || this.defaultCountry;
      
      const phoneNumber: PhoneNumber = parsePhoneNumber(phoneNumberInput, countryCode);
      
      if (!phoneNumber) {
        return {
          isValid: false,
          error: 'Invalid phone number format'
        };
      }

      if (!phoneNumber.isValid()) {
        return {
          isValid: false,
          error: 'Phone number is not valid for the given country'
        };
      }

      return {
        isValid: true,
        e164Format: phoneNumber.format('E.164'),
        nationalFormat: phoneNumber.formatNational(),
        internationalFormat: phoneNumber.formatInternational(),
        country: phoneNumber.country,
        type: phoneNumber.getType()
      };
    } catch (error) {
      return {
        isValid: false,
        error: error instanceof Error ? error.message : 'Failed to parse phone number'
      };
    }
  }

  formatForDisplay(e164PhoneNumber: string): string {
    try {
      const phoneNumber = parsePhoneNumber(e164PhoneNumber);
      
      if (!phoneNumber) {
        return e164PhoneNumber;
      }

      if (phoneNumber.country === 'US') {
        return phoneNumber.formatNational();
      }

      return phoneNumber.formatInternational();
    } catch (error) {
      return e164PhoneNumber;
    }
  }
}

export const phoneValidationService = new PhoneValidationService('US');

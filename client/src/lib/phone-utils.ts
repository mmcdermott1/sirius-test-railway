import { parsePhoneNumber, CountryCode } from 'libphonenumber-js';

export function formatPhoneNumberForDisplay(phoneNumber: string, countryCode: CountryCode = 'US'): string {
  try {
    const parsed = parsePhoneNumber(phoneNumber, countryCode);
    
    if (!parsed) {
      return phoneNumber;
    }

    if (parsed.country === 'US') {
      return parsed.formatNational();
    }

    return parsed.formatInternational();
  } catch (error) {
    return phoneNumber;
  }
}

export function validatePhoneNumber(phoneNumber: string, countryCode: CountryCode = 'US'): { isValid: boolean; error?: string } {
  try {
    const parsed = parsePhoneNumber(phoneNumber, countryCode);
    
    if (!parsed) {
      return { isValid: false, error: 'Invalid phone number format' };
    }

    if (!parsed.isValid()) {
      return { isValid: false, error: 'Phone number is not valid' };
    }

    return { isValid: true };
  } catch (error) {
    return { 
      isValid: false, 
      error: error instanceof Error ? error.message : 'Failed to parse phone number' 
    };
  }
}

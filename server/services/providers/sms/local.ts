import type { ConnectionTestResult } from '../base';
import type { SmsTransport, PhoneValidationResult, SmsSendResult, SmsProviderSettings } from './index';
import { parsePhoneNumber, isValidPhoneNumber } from 'libphonenumber-js';

export class LocalSmsProvider implements SmsTransport {
  readonly id = 'local';
  readonly displayName = 'Local (Validation Only)';
  readonly category = 'sms' as const;
  readonly supportedFeatures = ['phone-validation'];

  private settings: SmsProviderSettings = {};

  async configure(config: unknown): Promise<void> {
    if (config && typeof config === 'object') {
      this.settings = config as SmsProviderSettings;
    }
  }

  async testConnection(): Promise<ConnectionTestResult> {
    return {
      success: true,
      message: 'Local provider is always available (no external connection required)',
    };
  }

  async getConfiguration(): Promise<Record<string, unknown>> {
    return {
      connected: true,
      provider: 'local',
      capabilities: this.supportedFeatures,
    };
  }

  async validatePhone(phoneNumber: string): Promise<PhoneValidationResult> {
    try {
      if (!isValidPhoneNumber(phoneNumber, 'US')) {
        const parsed = parsePhoneNumber(phoneNumber, 'US');
        if (!parsed || !parsed.isValid()) {
          return {
            valid: false,
            error: 'Invalid phone number format',
          };
        }
      }

      const parsed = parsePhoneNumber(phoneNumber, 'US');
      if (!parsed) {
        return {
          valid: false,
          error: 'Could not parse phone number',
        };
      }

      return {
        valid: true,
        formatted: parsed.format('E.164'),
        countryCode: parsed.country,
        nationalNumber: parsed.nationalNumber,
        type: parsed.getType() || 'unknown',
      };
    } catch (error: any) {
      return {
        valid: false,
        error: error?.message || 'Validation failed',
      };
    }
  }

  supportsSms(): boolean {
    return false;
  }

  async sendSms(params: {
    to: string;
    body: string;
    from?: string;
    statusCallbackUrl?: string;
  }): Promise<SmsSendResult> {
    return {
      success: false,
      error: 'SMS sending is not supported by the local provider. Configure Twilio or another SMS provider to enable SMS functionality.',
    };
  }

  async getDefaultFromNumber(): Promise<string | undefined> {
    return undefined;
  }
}

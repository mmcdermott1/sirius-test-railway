import { registerSmsProviders } from './sms/register';
import { registerEmailProviders } from './email/register';

export function initializeServiceProviders(): void {
  registerSmsProviders();
  registerEmailProviders();
}

initializeServiceProviders();

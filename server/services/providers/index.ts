import { registerSmsProviders } from './sms/register';

export function initializeServiceProviders(): void {
  registerSmsProviders();
}

initializeServiceProviders();

import { wizardRegistry } from './registry.js';
import { gbhetLegalWorkersMonthly } from './types/gbhet_legal_workers_monthly.js';
import { gbhetLegalWorkersCorrections } from './types/gbhet_legal_workers_corrections.js';

wizardRegistry.register(gbhetLegalWorkersMonthly);
wizardRegistry.register(gbhetLegalWorkersCorrections);

export { wizardRegistry, getWizardType, getAllWizardTypes, registerWizardType } from './registry.js';
export { BaseWizard, type WizardTypeDefinition, type WizardStep, type WizardStatus } from './base.js';
export { FeedWizard, type FeedConfig, type FeedData } from './feed.js';

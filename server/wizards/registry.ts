import { WizardTypeDefinition } from './base.js';

class WizardTypeRegistry {
  private types: Map<string, WizardTypeDefinition> = new Map();

  register(wizardType: WizardTypeDefinition): void {
    if (this.types.has(wizardType.name)) {
      throw new Error(`Wizard type "${wizardType.name}" is already registered`);
    }
    this.types.set(wizardType.name, wizardType);
  }

  get(name: string): WizardTypeDefinition | undefined {
    return this.types.get(name);
  }

  getAll(): WizardTypeDefinition[] {
    return Array.from(this.types.values());
  }

  getAllNames(): string[] {
    return Array.from(this.types.keys());
  }

  has(name: string): boolean {
    return this.types.has(name);
  }

  getFeedTypes(): WizardTypeDefinition[] {
    return this.getAll().filter(type => type.isFeed);
  }

  getNonFeedTypes(): WizardTypeDefinition[] {
    return this.getAll().filter(type => !type.isFeed);
  }

  async validateType(name: string): Promise<{ valid: boolean; error?: string }> {
    if (!this.has(name)) {
      return {
        valid: false,
        error: `Unknown wizard type: ${name}. Available types: ${this.getAllNames().join(', ')}`
      };
    }
    return { valid: true };
  }

  async getStepsForType(name: string): Promise<any[]> {
    const wizardType = this.get(name);
    if (!wizardType) {
      throw new Error(`Wizard type "${name}" not found`);
    }
    return await wizardType.getSteps();
  }

  async getStatusesForType(name: string): Promise<any[]> {
    const wizardType = this.get(name);
    if (!wizardType) {
      throw new Error(`Wizard type "${name}" not found`);
    }
    return await wizardType.getStatuses();
  }
}

export const wizardRegistry = new WizardTypeRegistry();

export function registerWizardType(wizardType: WizardTypeDefinition): void {
  wizardRegistry.register(wizardType);
}

export function getWizardType(name: string): WizardTypeDefinition | undefined {
  return wizardRegistry.get(name);
}

export function getAllWizardTypes(): WizardTypeDefinition[] {
  return wizardRegistry.getAll();
}

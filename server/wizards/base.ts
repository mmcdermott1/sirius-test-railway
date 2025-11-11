export interface WizardStep {
  id: string;
  name: string;
  description?: string;
}

export interface WizardStatus {
  id: string;
  name: string;
  description?: string;
}

export interface WizardTypeDefinition {
  name: string;
  displayName: string;
  description?: string;
  isFeed?: boolean;
  getSteps: () => WizardStep[] | Promise<WizardStep[]>;
  getStatuses: () => WizardStatus[] | Promise<WizardStatus[]>;
}

export abstract class BaseWizard implements WizardTypeDefinition {
  abstract name: string;
  abstract displayName: string;
  abstract description?: string;
  isFeed: boolean = false;

  abstract getSteps(): WizardStep[] | Promise<WizardStep[]>;
  abstract getStatuses(): WizardStatus[] | Promise<WizardStatus[]>;

  validateData(data: any): { valid: boolean; errors?: string[] } {
    return { valid: true };
  }

  async canTransition(fromStatus: string, toStatus: string): Promise<boolean> {
    const statuses = await this.getStatuses();
    const validStatuses = statuses.map(s => s.id);
    return validStatuses.includes(toStatus);
  }

  async getNextSteps(currentStep: string): Promise<WizardStep[]> {
    const steps = await this.getSteps();
    const currentIndex = steps.findIndex(s => s.id === currentStep);
    
    if (currentIndex === -1 || currentIndex === steps.length - 1) {
      return [];
    }
    
    return [steps[currentIndex + 1]];
  }

  async getPreviousSteps(currentStep: string): Promise<WizardStep[]> {
    const steps = await this.getSteps();
    const currentIndex = steps.findIndex(s => s.id === currentStep);
    
    if (currentIndex <= 0) {
      return [];
    }
    
    return [steps[currentIndex - 1]];
  }
}

export function createStandardStatuses(): WizardStatus[] {
  return [
    { id: 'draft', name: 'Draft', description: 'Initial state' },
    { id: 'in_progress', name: 'In Progress', description: 'Wizard is actively being worked on' },
    { id: 'completed', name: 'Completed', description: 'Wizard has been completed' },
    { id: 'cancelled', name: 'Cancelled', description: 'Wizard was cancelled' },
    { id: 'error', name: 'Error', description: 'An error occurred during processing' }
  ];
}

export function formatWizardDate(date: Date): string {
  return date.toISOString().split('T')[0];
}

export function parseWizardData<T>(data: any, schema?: any): T {
  if (schema && typeof schema.parse === 'function') {
    return schema.parse(data);
  }
  return data as T;
}

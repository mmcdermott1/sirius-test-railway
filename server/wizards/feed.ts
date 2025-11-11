import { BaseWizard, WizardStep, WizardStatus, createStandardStatuses } from './base.js';

export interface FeedConfig {
  outputFormat?: 'csv' | 'json' | 'excel';
  includeHeaders?: boolean;
  dateRange?: {
    start: Date;
    end: Date;
  };
}

export interface FeedData {
  recordCount?: number;
  generatedAt?: Date;
  filters?: Record<string, any>;
  outputPath?: string;
}

export abstract class FeedWizard extends BaseWizard {
  isFeed: boolean = true;

  getSteps(): WizardStep[] {
    return [
      { id: 'configure', name: 'Configure Feed', description: 'Set feed parameters and filters' },
      { id: 'generate', name: 'Generate Data', description: 'Generate the feed data' },
      { id: 'review', name: 'Review Output', description: 'Review generated feed' },
      { id: 'complete', name: 'Complete', description: 'Feed generation complete' }
    ];
  }

  getStatuses(): WizardStatus[] {
    return [
      ...createStandardStatuses(),
      { id: 'generating', name: 'Generating', description: 'Feed data is being generated' },
      { id: 'ready', name: 'Ready', description: 'Feed is ready for download' }
    ];
  }

  async generateFeed(config: FeedConfig, data: any): Promise<FeedData> {
    throw new Error('generateFeed must be implemented by subclass');
  }

  async validateConfig(config: FeedConfig): Promise<{ valid: boolean; errors?: string[] }> {
    const errors: string[] = [];

    if (config.dateRange) {
      if (config.dateRange.start > config.dateRange.end) {
        errors.push('Start date must be before end date');
      }
    }

    return {
      valid: errors.length === 0,
      errors: errors.length > 0 ? errors : undefined
    };
  }

  formatOutputFilename(baseName: string, format: string = 'csv'): string {
    const timestamp = new Date().toISOString().split('T')[0];
    return `${baseName}_${timestamp}.${format}`;
  }

  async getRecordCount(filters?: Record<string, any>): Promise<number> {
    return 0;
  }

  serializeToCSV(records: any[], headers?: string[]): string {
    if (records.length === 0) return '';

    const allHeaders = headers || Object.keys(records[0]);
    const csvHeaders = allHeaders.join(',');
    
    const csvRows = records.map(record => {
      return allHeaders.map(header => {
        const value = record[header];
        if (value === null || value === undefined) return '';
        if (typeof value === 'string' && (value.includes(',') || value.includes('"') || value.includes('\n'))) {
          return `"${value.replace(/"/g, '""')}"`;
        }
        return value;
      }).join(',');
    });

    return [csvHeaders, ...csvRows].join('\n');
  }

  serializeToJSON(records: any[]): string {
    return JSON.stringify(records, null, 2);
  }
}

export function createMonthlyDateRange(year: number, month: number): { start: Date; end: Date } {
  const start = new Date(year, month - 1, 1);
  const end = new Date(year, month, 0, 23, 59, 59, 999);
  return { start, end };
}

export function getCurrentMonth(): { year: number; month: number } {
  const now = new Date();
  return {
    year: now.getFullYear(),
    month: now.getMonth() + 1
  };
}

export function formatMonthYear(year: number, month: number): string {
  const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December'];
  return `${monthNames[month - 1]} ${year}`;
}

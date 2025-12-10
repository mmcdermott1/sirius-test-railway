import { FloodEventDefinition } from "./types";
import { logger } from "../logger";

interface FloodEventDefaults {
  threshold: number;
  windowSeconds: number;
}

class FloodEventRegistry {
  private events: Map<string, FloodEventDefinition> = new Map();
  private defaults: Map<string, FloodEventDefaults> = new Map();

  register(event: FloodEventDefinition): void {
    if (this.events.has(event.name)) {
      throw new Error(`Flood event "${event.name}" is already registered`);
    }
    this.events.set(event.name, event);
    this.defaults.set(event.name, {
      threshold: event.threshold,
      windowSeconds: event.windowSeconds,
    });
    logger.info(`Registered flood event: ${event.name}`, { 
      service: 'flood-registry',
      threshold: event.threshold,
      windowSeconds: event.windowSeconds,
    });
  }

  get(name: string): FloodEventDefinition | undefined {
    return this.events.get(name);
  }

  has(name: string): boolean {
    return this.events.has(name);
  }

  getAll(): FloodEventDefinition[] {
    return Array.from(this.events.values());
  }

  getAllDefinitions(): { name: string; threshold: number; windowSeconds: number }[] {
    return Array.from(this.events.values()).map(e => ({
      name: e.name,
      threshold: e.threshold,
      windowSeconds: e.windowSeconds,
    }));
  }

  updateConfig(name: string, threshold: number, windowSeconds: number): boolean {
    const event = this.events.get(name);
    if (!event) return false;
    event.threshold = threshold;
    event.windowSeconds = windowSeconds;
    return true;
  }

  resetToDefaults(name: string): boolean {
    const event = this.events.get(name);
    const defaultConfig = this.defaults.get(name);
    if (!event || !defaultConfig) return false;
    event.threshold = defaultConfig.threshold;
    event.windowSeconds = defaultConfig.windowSeconds;
    return true;
  }

  getDefaults(name: string): FloodEventDefaults | undefined {
    return this.defaults.get(name);
  }
}

export const floodEventRegistry = new FloodEventRegistry();

export function registerFloodEvent(event: FloodEventDefinition): void {
  floodEventRegistry.register(event);
}

export function getFloodEvent(name: string): FloodEventDefinition | undefined {
  return floodEventRegistry.get(name);
}

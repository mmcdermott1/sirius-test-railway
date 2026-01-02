import { logger } from "../../logger";
import { dispatchEligPluginRegistry } from "../dispatch-elig-plugin-registry";
import { dispatchBanPlugin } from "./ban";
import { dispatchDncPlugin } from "./dnc";
import { dispatchHfePlugin } from "./hfe";
import { dispatchStatusPlugin } from "./status";

/**
 * Registers all dispatch eligibility plugins.
 * Each plugin declares its own event handlers, which are automatically
 * subscribed by the registry during registration.
 */
export function registerDispatchEligPlugins(): void {
  dispatchEligPluginRegistry.register(dispatchBanPlugin);
  dispatchEligPluginRegistry.register(dispatchDncPlugin);
  dispatchEligPluginRegistry.register(dispatchHfePlugin);
  dispatchEligPluginRegistry.register(dispatchStatusPlugin);
  
  logger.info("Dispatch eligibility plugins registered", {
    service: "dispatch-elig-plugins",
    plugins: dispatchEligPluginRegistry.getAllPluginIds(),
  });
}

/**
 * Initializes the dispatch eligibility system.
 * Plugins register themselves and their event handlers automatically.
 */
export function initializeDispatchEligSystem(): void {
  registerDispatchEligPlugins();
}

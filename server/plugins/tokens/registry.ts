import { PluginRegistry } from "../_core/registry";
import type { TokenPlugin, TokenPluginMetadata, TokenEntityType } from "./types";

export const tokenPluginRegistry = new PluginRegistry<TokenPlugin, TokenPluginMetadata>({
  kind: "token",
  getMetadata: (plugin) => plugin.metadata,
  toManifestEntry: (plugin) => plugin.metadata,
});

let registrations = 0;

type TokenPluginListener = (plugin: TokenPlugin) => void;
const registrationListeners: TokenPluginListener[] = [];

/**
 * Watch registrations. For the parts of the graph that are DERIVED from
 * what other plugins declare (the options relations, generated from an
 * entity table's foreign keys): registration is not a boot-only event —
 * a notifier module imported after the first render registers plugins
 * too — so a derived segment cannot be generated in one pass and then
 * assumed complete, or a late plugin silently has none.
 */
export function onTokenPluginRegistered(listener: TokenPluginListener): void {
  registrationListeners.push(listener);
}

export function registerTokenPlugin(plugin: TokenPlugin): void {
  tokenPluginRegistry.register(plugin);
  registrations++;
  for (const listener of registrationListeners) listener(plugin);
}

/**
 * Bumped by every registration. Derived caches (the field catalog) key
 * themselves on it, so a plugin registered late — a named record root
 * declared by a notifier module imported after the first render — is
 * never missed by a cache built before it existed.
 */
export function tokenRegistryVersion(): number {
  return registrations;
}

/**
 * Same purpose, for a change that alters what a REGISTERED plugin's
 * metadata says (a second surface declaring extra merged fields on a
 * shared named record root) rather than adding a plugin.
 */
export function bumpTokenRegistryVersion(): void {
  registrations++;
}

/**
 * Resolve which plugin handles a segment name given the current entity
 * type. Segment names are only unique per input type, so lookup is by
 * (name, inputType) — not by registry id. Only component-enabled
 * plugins participate.
 */
export function findSegmentPlugin(
  name: string,
  inputType: TokenEntityType,
): TokenPlugin | undefined {
  return tokenPluginRegistry
    .listEnabledSync()
    .find(
      (p) =>
        p.metadata.segmentName === name &&
        (p.metadata.inputTypes.includes(inputType) ||
          (p.metadata.inputTypes.includes("*") &&
            inputType !== "root" &&
            inputType !== "value")),
    );
}

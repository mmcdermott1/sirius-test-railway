import { PluginRegistry } from "../_core/registry";
import type { TokenPlugin, TokenPluginMetadata, TokenEntityType } from "./types";

export const tokenPluginRegistry = new PluginRegistry<TokenPlugin, TokenPluginMetadata>({
  kind: "token",
  getMetadata: (plugin) => plugin.metadata,
  toManifestEntry: (plugin) => plugin.metadata,
});

let registrations = 0;

export function registerTokenPlugin(plugin: TokenPlugin): void {
  tokenPluginRegistry.register(plugin);
  registrations++;
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

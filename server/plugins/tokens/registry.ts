import { PluginRegistry } from "../_core/registry";
import type { TokenPlugin, TokenPluginMetadata, TokenEntityType } from "./types";

export const tokenPluginRegistry = new PluginRegistry<TokenPlugin, TokenPluginMetadata>({
  kind: "token",
  getMetadata: (plugin) => plugin.metadata,
  toManifestEntry: (plugin) => plugin.metadata,
});

export function registerTokenPlugin(plugin: TokenPlugin): void {
  tokenPluginRegistry.register(plugin);
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
        p.metadata.inputTypes.includes(inputType),
    );
}

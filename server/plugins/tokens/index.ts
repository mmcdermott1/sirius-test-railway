import { logger } from "../../logger";
import { registerPluginKind } from "../_core/kinds";
import { tokenPluginRegistry } from "./registry";

export * from "./types";
export { tokenPluginRegistry, registerTokenPlugin, findSegmentPlugin } from "./registry";
export {
  renderTokens,
  evaluateChain,
  createTokenEvalContext,
  buildSegmentSpecs,
  buildSegmentSpecsForEvent,
  buildFieldCatalog,
  buildTokenCatalog,
  buildTokenCatalogForEvent,
  validateTokenExpression,
  validateTokenExpressionForEvent,
  describeChain,
} from "./evaluate";

let kindRegistered = false;
function registerTokenKind(): void {
  if (kindRegistered) return;
  registerPluginKind({
    kind: "token",
    registry: tokenPluginRegistry,
    label: "Tokens",
    description:
      "Chained template tokens ({{worker.field(name=\"job_title\")}}, {{contact.address.field(name=\"street\")}}) resolved per recipient when messages are rendered.",
    // Token authoring surfaces (bulk messages) are gated by bulk.edit;
    // the kind itself carries the same policy for manifest visibility.
    requiredPolicy: "bulk.edit",
    sortEntries: (a, b) => a.id.localeCompare(b.id),
  });
  kindRegistered = true;
}

/**
 * Initialize the token plugin system: register the kind. Plugins
 * self-register via the side-effect imports at the bottom of this
 * file. There is no config adapter — token plugins have no persisted
 * configuration; the registry is the single source of truth.
 */
export function initializeTokenPluginSystem(): void {
  registerTokenKind();
  logger.info("Token plugins registered", {
    service: "tokens",
    plugins: tokenPluginRegistry.listIds(),
  });
}

// Plugin registrations (side-effect imports — each file self-registers).
import "./plugins/field";
import "./plugins/contact";
import "./plugins/worker";
import "./plugins/employer";
import "./plugins/system";
import "./plugins/address";
import "./plugins/event";
import "./plugins/sitespecific-t631-interview";

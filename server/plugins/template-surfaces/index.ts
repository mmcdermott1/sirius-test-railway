import { logger } from "../../logger";
import { templateSurfaceRegistry } from "./registry";

export * from "./types";
export {
  templateSurfaceRegistry,
  registerTemplateSurface,
  getTemplateSurface,
  validateSurfaceFields,
} from "./registry";
export {
  renderTemplateSurface,
  type TemplateFieldPreview,
  type TemplateSurfacePreview,
} from "./render";

/**
 * Initialize the template-surface registry. Surfaces self-register via
 * the side-effect imports below; there is no config adapter and no
 * plugin kind — a surface has no persisted configuration and is never
 * listed in the admin plugin manifest.
 */
export function initializeTemplateSurfaces(): void {
  logger.info("Template surfaces registered", {
    service: "template-surfaces",
    surfaces: templateSurfaceRegistry.listIds(),
  });
}

// Surface registrations (side-effect imports — each file self-registers).
import "./surfaces/event-notifier";
import "./surfaces/bulk-message";
import "./surfaces/ad-hoc";

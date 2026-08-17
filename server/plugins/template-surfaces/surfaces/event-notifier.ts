import { mergeChannelFieldSpecs, registerTemplateSurface } from "../registry";
import { TemplateSurfaceError, type TemplateSurfaceResolution } from "../types";
import { NOTIFIER_CHANNEL_FIELDS as CHANNEL_FIELDS } from "../../event-notifier/field-media";

/** Merge the editor's in-progress values into a config's templates block. */
function mergeChannelValues(
  configData: unknown,
  channel: string,
  values: Record<string, string>,
): Record<string, unknown> {
  const base =
    configData && typeof configData === "object"
      ? { ...(configData as Record<string, unknown>) }
      : {};
  const templates =
    base.templates && typeof base.templates === "object"
      ? { ...(base.templates as Record<string, unknown>) }
      : {};
  const existing =
    templates[channel] && typeof templates[channel] === "object"
      ? (templates[channel] as Record<string, unknown>)
      : {};
  templates[channel] = { ...existing, ...values };
  base.templates = templates;
  return base;
}

/**
 * Event-notifier message templates. The editor edits ONE channel group
 * of a config's `data.templates`; the delivered text is the notifier's
 * default template overridden field-by-field by the admin's custom
 * text, so the preview must resolve the same merge (`resolveTemplates`)
 * with the in-progress values applied on top.
 */
registerTemplateSurface({
  id: "event-notifier",
  name: "Event notifier message templates",
  description:
    "One channel group (email / SMS / in-app) of a token-templated notifier's message templates.",
  fields: mergeChannelFieldSpecs(CHANNEL_FIELDS),
  async resolve({ params, values }): Promise<TemplateSurfaceResolution> {
    const pluginId = typeof params.pluginId === "string" ? params.pluginId : "";
    const channel = typeof params.channel === "string" ? params.channel : "";
    const specs = CHANNEL_FIELDS[channel];
    if (!specs) {
      throw new TemplateSurfaceError(400, `Unknown notifier channel "${channel}"`);
    }

    const { eventNotifierRegistry } = await import(
      "../../event-notifier/registry"
    );
    const plugin = eventNotifierRegistry.get(pluginId);
    if (!plugin?.tokenTemplates) {
      throw new TemplateSurfaceError(
        404,
        "Notifier not found or not token-templated",
      );
    }

    const { resolveTemplates } = await import(
      "../../event-notifier/token-templates"
    );
    const merged = mergeChannelValues(params.configData, channel, values);
    const resolved = resolveTemplates(plugin, merged) as Record<
      string,
      Record<string, string> | undefined
    >;
    const channelTemplates = resolved[channel] ?? {};

    // Every field of the channel is in play, blank ones included: an
    // empty required field is what makes delivery send nothing at all.
    const templates: Record<string, string> = {};
    for (const spec of specs) {
      const template = channelTemplates[spec.key];
      templates[spec.key] = typeof template === "string" ? template : "";
    }

    return {
      templates,
      eventEntityKind: plugin.tokenTemplates.eventEntityKind,
    };
  },
});

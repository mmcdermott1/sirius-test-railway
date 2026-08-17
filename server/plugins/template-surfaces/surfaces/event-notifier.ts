import { mergeChannelFieldSpecs, registerTemplateSurface } from "../registry";
import {
  TemplateSurfaceError,
  type TemplateSurfaceContextRequest,
  type TemplateSurfacePreviewContext,
  type TemplateSurfaceResolution,
  type TemplateSurfaceResolvedContext,
} from "../types";
import type { TokenRecentRecordRef, TokenRootSeed } from "../../tokens/types";
import { EVENT_ROOT_NAME } from "../../tokens/plugins/event";
import type { NotifierRecordRoot } from "../../event-notifier/types";
import { NOTIFIER_CHANNEL_FIELDS as CHANNEL_FIELDS } from "../../event-notifier/field-media";

/**
 * How many real records the notifier offers as preview subjects. A
 * handful, deliberately: this is "preview against something that
 * actually happened", not a record browser.
 */
const RECENT_LIMIT = 5;

/** Prefix marking a context id as "one record of the event kind". */
const RECORD_PREFIX = "record:";

/**
 * The record roots the notifier being edited seeds, in declaration
 * order. `event` (the envelope) is seeded by every notifier and is
 * appended by {@link rootNamesOf}, not declared per notifier.
 */
async function notifierRootsOf(
  params: Record<string, unknown>,
): Promise<NotifierRecordRoot[]> {
  const pluginId = typeof params.pluginId === "string" ? params.pluginId : "";
  if (!pluginId) return [];
  const { eventNotifierRegistry } = await import("../../event-notifier/registry");
  return eventNotifierRegistry.get(pluginId)?.tokenTemplates?.roots ?? [];
}

/** Every root name a notifier's templates may address. */
function rootNamesOf(roots: NotifierRecordRoot[]): string[] {
  return [...roots.map((root) => root.name), EVENT_ROOT_NAME];
}

/**
 * The recent records of the notifier's own event kind, or [] when this
 * user may not edit notifier templates.
 *
 * The preview routes are staff-gated, but a notifier's templates (and
 * its token catalog) are admin-only — so real records reachable through
 * this editor must clear the same bar, not merely "staff". A surface
 * authorizes its own contexts precisely because only it knows this.
 *
 * Component gating lives in the provider lookup: a notifier for a
 * disabled component offers nothing rather than erroring on absent
 * tables.
 */
async function recentEventRecords({
  params,
  req,
}: TemplateSurfaceContextRequest): Promise<
  Array<{ rootName: string; record: TokenRecentRecordRef }>
> {
  const { checkAccessInline } = await import("../../../services/access-policy-evaluator");
  const access = await checkAccessInline(req, "admin");
  if (!access.granted) return [];

  // The notifier's PRIMARY record root: the record the notice is about.
  // Additional roots (when a notifier grows one) preview as samples
  // until they offer recent records of their own.
  const root = (await notifierRootsOf(params))[0];
  if (!root) return [];
  const { getEnabledTokenRecentRecords } = await import("../../tokens/preview-roots");
  const provider = await getEnabledTokenRecentRecords(root.kind);
  if (!provider) return [];
  const records = await provider.recent(RECENT_LIMIT);
  return records.map((record) => ({ rootName: root.name, record }));
}

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
      rootNames: rootNamesOf(plugin.tokenTemplates.roots),
    };
  },

  /**
   * Offer the notifier's own recent event records. Nothing else: the
   * author is editing the message THIS notifier sends, so the records
   * it fires on are the only real data the studio has any business
   * rendering here. Gated on the same access notifier-template editing
   * needs (see `recentEventRecords`), and again per record kind by its
   * component.
   */
  async listPreviewContexts(
    ctx: TemplateSurfaceContextRequest,
  ): Promise<TemplateSurfacePreviewContext[]> {
    const records = await recentEventRecords(ctx);
    return records.map(({ record }) => ({
      id: `${RECORD_PREFIX}${record.id}`,
      label: record.label,
    }));
  },

  async resolvePreviewContext(
    id: string,
    ctx: TemplateSurfaceContextRequest,
  ): Promise<TemplateSurfaceResolvedContext | null> {
    if (!id.startsWith(RECORD_PREFIX)) return null;
    const recordId = id.slice(RECORD_PREFIX.length);
    // Re-list rather than load by id: the offer IS the authorization,
    // so a record that is no longer offered — or an editor who may no
    // longer edit notifiers — can no longer render it.
    const records = await recentEventRecords(ctx);
    const match = records.find(({ record }) => record.id === recordId);
    if (!match) return null;
    const seed: TokenRootSeed = {
      name: match.rootName,
      entity: match.record.entity,
    };
    return { seeds: [seed] };
  },
});

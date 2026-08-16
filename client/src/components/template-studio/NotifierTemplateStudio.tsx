import { useMemo } from "react";
import { TemplateStudio, type StudioField, type StudioPreviewResult } from "./TemplateStudio";
import { useStudioPreviewContext } from "./StudioContext";
import type {
  TokenCatalogEntry,
  TokenFieldCatalog,
  TokenSegmentSpec,
} from "@shared/tokens";

// ─────────────────────────────────────────────────────────────────────────────
// Channel metadata: which template fields each channel has and how they edit.
// Mirrors NotifierChannelTemplates on the server.
// ─────────────────────────────────────────────────────────────────────────────

const CHANNEL_FIELDS: Record<string, StudioField[]> = {
  email: [
    { key: "subject", label: "Subject", mode: "line" },
    { key: "bodyHtml", label: "Body (HTML)", mode: "html" },
  ],
  sms: [{ key: "message", label: "Message", mode: "multiline" }],
  inapp: [
    { key: "title", label: "Title", mode: "line" },
    { key: "body", label: "Body", mode: "multiline" },
    { key: "linkUrl", label: "Link URL (relative)", mode: "line" },
    { key: "linkLabel", label: "Link label", mode: "line" },
  ],
};

const CHANNEL_TITLES: Record<string, string> = {
  email: "Email templates",
  sms: "SMS template",
  inapp: "In-app notification templates",
};

export interface NotifierTokenCatalog {
  eventEntityKind: string;
  segments: TokenSegmentSpec[];
  fields?: TokenFieldCatalog;
  defaults?: Record<string, Record<string, string>>;
  tokens?: TokenCatalogEntry[];
  realRecordPreview?: boolean;
}

interface FieldPreview {
  rendered: string;
  unknownTokens: string[];
  missingValues: string[];
}

interface NotifierPreviewResponse {
  sample: boolean;
  contactId: string | null;
  channels: Record<string, Record<string, FieldPreview>>;
}

export interface NotifierTemplateStudioProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  pluginId: string;
  /** "email" | "sms" | "inapp" — the channel group being edited. */
  channel: string;
  catalog: NotifierTokenCatalog | undefined;
  /** The full live config data (for preview + reading current templates). */
  configData: Record<string, unknown>;
  /** Writes one template field back into the host form's config data. */
  updateConfigData: (path: string, value: unknown) => void;
  disabled?: boolean;
}

/**
 * Event-notifier host for the Template Studio: edits one channel group of
 * `data.templates` and previews through the notifier preview endpoint
 * (which mirrors delivery-time template composition). Sample / real-record
 * context comes from the shared studio context builder; record search is
 * served by the generic per-entity-kind preview registry.
 */
export function NotifierTemplateStudio({
  open,
  onOpenChange,
  pluginId,
  channel,
  catalog,
  configData,
  updateConfigData,
  disabled,
}: NotifierTemplateStudioProps) {
  const eventEntityKind = catalog?.eventEntityKind ?? "";
  const ctx = useStudioPreviewContext({
    open,
    realRecordPreview: !!catalog?.realRecordPreview && !!eventEntityKind,
    entitySearchUrl: (q) =>
      `/api/token-studio/preview-entities/${encodeURIComponent(eventEntityKind)}?q=${encodeURIComponent(q)}`,
  });

  // ── Fields & values (channel group of data.templates) ─────────────────────
  const defaults = catalog?.defaults?.[channel] ?? {};
  const fields: StudioField[] = useMemo(() => {
    const base = CHANNEL_FIELDS[channel] ?? [];
    // Only offer fields the notifier's defaults declare (e.g. a notifier
    // without an in-app linkLabel shouldn't grow one here), but always
    // keep the core fields even if the default is empty.
    return base
      .filter((f) => f.key in defaults || ["subject", "bodyHtml", "message", "title", "body"].includes(f.key))
      .map((f) => ({
        ...f,
        placeholder: defaults[f.key] && f.mode !== "html" ? defaults[f.key] : undefined,
        hint:
          defaults[f.key] !== undefined
            ? "Blank = the notifier's default template is used."
            : undefined,
      }));
  }, [channel, defaults]);

  const templates =
    (configData.templates as Record<string, Record<string, unknown>> | undefined) ?? {};
  const channelValues: Record<string, string> = {};
  for (const f of fields) {
    const v = templates[channel]?.[f.key];
    channelValues[f.key] = typeof v === "string" ? v : "";
  }

  // ── Preview ────────────────────────────────────────────────────────────────
  const fetchPreview = async (values: Record<string, string>): Promise<StudioPreviewResult> => {
    // Compose the live configData with the in-studio values so the preview
    // always reflects what's on screen (even before RJSF state syncs).
    const merged = {
      ...configData,
      templates: {
        ...templates,
        [channel]: { ...(templates[channel] ?? {}), ...values },
      },
    };
    const body: Record<string, unknown> = { configData: merged };
    if (ctx.realActive && ctx.entity) body.eventEntityId = ctx.entity.id;
    if (ctx.realActive && ctx.recipient) body.contactId = ctx.recipient.id;
    const res = await fetch(`/api/event-notifier/preview/${pluginId}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message ?? `Preview failed (${res.status})`);
    }
    const data = (await res.json()) as NotifierPreviewResponse;
    const ch = data.channels[channel] ?? {};
    return { sample: data.sample, fields: ch };
  };

  if (disabled) return null;

  return (
    <TemplateStudio
      open={open}
      onOpenChange={onOpenChange}
      title={CHANNEL_TITLES[channel] ?? `${channel} templates`}
      description="Edit the channel's tokenized templates with a live preview. Changes apply to the config form; save the config to persist them."
      channel={channel === "email" || channel === "sms" || channel === "inapp" ? channel : "generic"}
      fields={fields}
      values={channelValues}
      onValueChange={(key, value) => updateConfigData(`templates.${channel}.${key}`, value)}
      tokens={catalog?.tokens ?? []}
      segments={catalog?.segments}
      fieldCatalog={catalog?.fields}
      priorityScopes={["event"]}
      fetchPreview={fetchPreview}
      previewContextKey={ctx.previewContextKey}
      contextPanel={ctx.contextPanel}
    />
  );
}

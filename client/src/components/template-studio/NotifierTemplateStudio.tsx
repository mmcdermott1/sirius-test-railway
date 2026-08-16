import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { TemplateStudio, type StudioField, type StudioPreviewResult } from "./TemplateStudio";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";
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

interface EntityRef {
  id: string;
  label: string;
}

interface ContactSearchRow {
  id: string;
  displayName?: string | null;
  given?: string | null;
  family?: string | null;
  email?: string | null;
}

/** Debounce a string value with a fixed 300 ms delay. */
function useDebounced(value: string): string {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), 300);
    return () => clearTimeout(t);
  }, [value]);
  return debounced;
}

/**
 * Search-and-pick list: an input plus a short result list; picking an item
 * collapses the list and shows the pick with a clear affordance.
 */
function SearchPicker({
  placeholder,
  selectedLabel,
  onClear,
  onQuery,
  results,
  onPick,
  loading,
  testId,
}: {
  placeholder: string;
  selectedLabel: string | null;
  onClear: () => void;
  onQuery: (q: string) => void;
  results: Array<{ id: string; label: string }>;
  onPick: (r: { id: string; label: string }) => void;
  loading?: boolean;
  testId: string;
}) {
  const [q, setQ] = useState("");
  if (selectedLabel) {
    return (
      <div className="flex items-center gap-2 text-sm" data-testid={`${testId}-selected`}>
        <span className="truncate rounded-md border bg-muted/40 px-2 py-1">{selectedLabel}</span>
        <button
          type="button"
          className="text-xs text-muted-foreground underline underline-offset-2 shrink-0"
          onClick={() => {
            onClear();
            setQ("");
            onQuery("");
          }}
          data-testid={`${testId}-clear`}
        >
          change
        </button>
      </div>
    );
  }
  return (
    <div className="space-y-1">
      <div className="relative">
        <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
        <Input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            onQuery(e.target.value);
          }}
          placeholder={placeholder}
          className="h-8 pl-7 text-sm"
          data-testid={`${testId}-input`}
        />
      </div>
      {(results.length > 0 || loading) && (
        <div className="max-h-36 overflow-y-auto rounded-md border bg-popover text-sm">
          {loading && <div className="px-2 py-1.5 text-xs text-muted-foreground">Searching…</div>}
          {results.map((r) => (
            <button
              key={r.id}
              type="button"
              className="w-full text-left px-2 py-1.5 hover-elevate"
              onClick={() => onPick(r)}
              data-testid={`${testId}-result-${r.id}`}
            >
              {r.label}
            </button>
          ))}
        </div>
      )}
    </div>
  );
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
 * `data.templates`, previews through the notifier preview endpoint, and
 * provides the sample / real-record context builder.
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
  // ── Context builder state ──────────────────────────────────────────────────
  const [mode, setMode] = useState<"sample" | "real">("sample");
  const [entity, setEntity] = useState<EntityRef | null>(null);
  const [recipient, setRecipient] = useState<EntityRef | null>(null);
  const [entityQuery, setEntityQuery] = useState("");
  const [recipientQuery, setRecipientQuery] = useState("");
  const debouncedEntityQuery = useDebounced(entityQuery);
  const debouncedRecipientQuery = useDebounced(recipientQuery);

  const realRecordPreview = !!catalog?.realRecordPreview;
  const realActive = mode === "real" && realRecordPreview;

  const { data: entityResults, isFetching: entityLoading } = useQuery<{ entities: EntityRef[] }>({
    queryKey: [
      `/api/event-notifier/preview-entities/${pluginId}?q=${encodeURIComponent(debouncedEntityQuery)}`,
    ],
    enabled: open && realActive && !entity,
  });

  const { data: contactResults, isFetching: contactLoading } = useQuery<ContactSearchRow[]>({
    queryKey: [`/api/contacts/search?q=${encodeURIComponent(debouncedRecipientQuery)}`],
    enabled: open && realActive && !recipient && debouncedRecipientQuery.trim().length >= 2,
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
    if (realActive && entity) body.eventEntityId = entity.id;
    if (realActive && recipient) body.contactId = recipient.id;
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

  const previewContextKey = realActive
    ? `real:${entity?.id ?? ""}:${recipient?.id ?? ""}`
    : "sample";

  // ── Context panel ──────────────────────────────────────────────────────────
  const contextPanel = (
    <div className="space-y-2" data-testid="studio-context-panel">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Preview with
      </p>
      <RadioGroup
        value={realActive ? "real" : "sample"}
        onValueChange={(v) => setMode(v === "real" ? "real" : "sample")}
        className="flex items-center gap-4"
      >
        <div className="flex items-center gap-1.5">
          <RadioGroupItem value="sample" id="studio-ctx-sample" data-testid="radio-context-sample" />
          <Label htmlFor="studio-ctx-sample" className="text-sm font-normal">
            Sample data
          </Label>
        </div>
        <div className={cn("flex items-center gap-1.5", !realRecordPreview && "opacity-50")}>
          <RadioGroupItem
            value="real"
            id="studio-ctx-real"
            disabled={!realRecordPreview}
            data-testid="radio-context-real"
          />
          <Label htmlFor="studio-ctx-real" className="text-sm font-normal">
            Real record
          </Label>
        </div>
      </RadioGroup>
      {realActive && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Record</p>
            <SearchPicker
              placeholder="Search records…"
              selectedLabel={entity?.label ?? null}
              onClear={() => setEntity(null)}
              onQuery={setEntityQuery}
              results={entityResults?.entities ?? []}
              onPick={(r) => setEntity(r)}
              loading={entityLoading}
              testId="studio-entity-picker"
            />
          </div>
          <div className="space-y-1">
            <p className="text-xs text-muted-foreground">Recipient (optional)</p>
            <SearchPicker
              placeholder="Search contacts (min 2 chars)…"
              selectedLabel={recipient?.label ?? null}
              onClear={() => setRecipient(null)}
              onQuery={setRecipientQuery}
              results={(contactResults ?? []).map((c) => ({
                id: c.id,
                label:
                  c.displayName ||
                  `${c.given ?? ""} ${c.family ?? ""}`.trim() ||
                  c.email ||
                  c.id,
              }))}
              onPick={(r) => setRecipient(r)}
              loading={contactLoading}
              testId="studio-recipient-picker"
            />
          </div>
        </div>
      )}
      {realActive && !entity && (
        <p className="text-xs text-muted-foreground">
          Pick a record to render the preview with its real data.
        </p>
      )}
    </div>
  );

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
      previewContextKey={previewContextKey}
      contextPanel={contextPanel}
    />
  );
}

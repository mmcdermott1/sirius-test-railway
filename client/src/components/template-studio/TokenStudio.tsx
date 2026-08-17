import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Maximize2 } from "lucide-react";
import {
  TemplateStudio,
  type StudioChannel,
  type StudioField,
  type StudioPreviewResult,
} from "./TemplateStudio";
import { useStudioPreviewContext } from "./StudioContext";
import type {
  TokenCatalogEntry,
  TokenFieldCatalog,
  TokenSegmentSpec,
} from "@shared/tokens";

interface TokenStudioCatalog {
  eventEntityKind: string | null;
  segments: TokenSegmentSpec[];
  fields?: TokenFieldCatalog;
  tokens: TokenCatalogEntry[];
  realRecordPreview: boolean;
}

interface TokenStudioPreviewResponse {
  sample: boolean;
  fields: Record<
    string,
    {
      rendered: string;
      unknownTokens: string[];
      missingValues: string[];
      emptyValues: string[];
    }
  >;
}

export interface TokenStudioProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  /** Preview presentation: email, sms, inapp, postal, or generic text. */
  channel: StudioChannel;
  fields: StudioField[];
  values: Record<string, string>;
  onValueChange: (key: string, value: string) => void;
  /**
   * Optional event entity kind rooting `{{event.*}}` tokens. When the
   * kind has a registered preview-entity provider, the context panel
   * offers "real record" mode automatically.
   */
  eventEntityKind?: string;
  /** Field keys whose output is HTML (rendered escaped + sanitized). */
  escapeHtmlFields?: string[];
  /** Scopes listed first in the token browser. */
  priorityScopes?: string[];
}

/**
 * THE generic token-editing popup: any tokenized string field anywhere
 * can open this. Token catalog, sample/real-record context, and preview
 * all come from the generic `/api/token-studio/*` endpoints — hosts only
 * say where the strings live and which channel presentation to use.
 *
 * Surfaces with bespoke preview semantics (event notifiers composing
 * defaults, bulk messages scoping recipients to participants) use their
 * dedicated hosts instead; everything else uses this one.
 */
export function TokenStudio({
  open,
  onOpenChange,
  title,
  description,
  channel,
  fields,
  values,
  onValueChange,
  eventEntityKind,
  escapeHtmlFields = [],
  priorityScopes,
}: TokenStudioProps) {
  const catalogUrl = eventEntityKind
    ? `/api/token-studio/catalog?event=${encodeURIComponent(eventEntityKind)}`
    : "/api/token-studio/catalog";
  const { data: catalog } = useQuery<TokenStudioCatalog>({
    queryKey: [catalogUrl],
    enabled: open,
  });

  const ctx = useStudioPreviewContext({
    open,
    realRecordPreview: !!catalog?.realRecordPreview && !!eventEntityKind,
    entitySearchUrl: eventEntityKind
      ? (q) =>
          `/api/token-studio/preview-entities/${encodeURIComponent(eventEntityKind)}?q=${encodeURIComponent(q)}`
      : undefined,
    // Without an event root, contact tokens are the whole context — a
    // recipient alone is a meaningful real preview.
    allowRecipientOnlyReal: !eventEntityKind,
  });

  const fetchPreview = async (v: Record<string, string>): Promise<StudioPreviewResult> => {
    const body: Record<string, unknown> = { fields: v, escapeHtmlFields };
    if (eventEntityKind) body.eventEntityKind = eventEntityKind;
    if (ctx.realActive && ctx.entity) body.eventEntityId = ctx.entity.id;
    if (ctx.realActive && ctx.recipient) body.contactId = ctx.recipient.id;
    const res = await fetch("/api/token-studio/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      credentials: "include",
    });
    if (!res.ok) {
      const err = await res.json().catch(() => ({}));
      throw new Error((err as { message?: string }).message ?? `Preview failed (${res.status})`);
    }
    const data = (await res.json()) as TokenStudioPreviewResponse;
    return { sample: data.sample, fields: data.fields };
  };

  return (
    <TemplateStudio
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description={description}
      channel={channel}
      fields={fields}
      values={values}
      onValueChange={onValueChange}
      tokens={catalog?.tokens ?? []}
      segments={catalog?.segments}
      fieldCatalog={catalog?.fields}
      priorityScopes={priorityScopes}
      fetchPreview={fetchPreview}
      previewContextKey={ctx.previewContextKey}
      contextPanel={ctx.contextPanel}
    />
  );
}

/**
 * Self-contained "open the token editor" affordance: a small button that
 * owns the popup's open state. Drop it next to any tokenized field.
 */
export function TokenStudioButton({
  label = "Open Template Studio",
  testId = "button-open-token-studio",
  ...studioProps
}: Omit<TokenStudioProps, "open" | "onOpenChange"> & {
  label?: string;
  testId?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button type="button" variant="outline" size="sm" onClick={() => setOpen(true)} data-testid={testId}>
        <Maximize2 className="h-4 w-4 mr-1.5" />
        {label}
      </Button>
      {open && <TokenStudio {...studioProps} open={open} onOpenChange={setOpen} />}
    </>
  );
}

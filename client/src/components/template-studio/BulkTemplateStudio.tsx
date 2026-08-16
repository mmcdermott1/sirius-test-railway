import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  TemplateStudio,
  type StudioChannel,
  type StudioField,
  type StudioPreviewResult,
} from "./TemplateStudio";
import { apiRequest } from "@/lib/queryClient";
import type {
  TokenCatalogEntry,
  TokenFieldCatalog,
  TokenSegmentSpec,
} from "@shared/tokens";

interface ParticipantRow {
  id: string;
  contactId: string;
  contactDisplayName?: string | null;
  contactGiven?: string | null;
  contactFamily?: string | null;
}

interface BulkPreviewResponse {
  sample: boolean;
  rendered: Record<string, { output: string; unknownTokens: string[]; missingValues: string[] }>;
}

export interface BulkTemplateStudioProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  messageId: string;
  title: string;
  channel: StudioChannel;
  fields: StudioField[];
  values: Record<string, string>;
  onValueChange: (key: string, value: string) => void;
  /**
   * Build the preview-endpoint `fields` payload from the current studio
   * values (e.g. in-app derives a plain-text `body` from `bodyHtml`).
   * Defaults to the values themselves.
   */
  previewFieldsFor?: (values: Record<string, string>) => Record<string, string>;
  /** Field names the preview endpoint should NOT HTML-escape (HTML bodies). */
  escapeHtmlFields?: string[];
}

/**
 * Bulk-message host for the Template Studio: previews through the
 * existing bulk preview endpoint with a participant-or-sample context
 * builder (preview recipients must be participants — server-enforced).
 */
export function BulkTemplateStudio({
  open,
  onOpenChange,
  messageId,
  title,
  channel,
  fields,
  values,
  onValueChange,
  previewFieldsFor,
  escapeHtmlFields = [],
}: BulkTemplateStudioProps) {
  const [contactId, setContactId] = useState<string>("__sample__");

  const { data: tokenData } = useQuery<{
    tokens: TokenCatalogEntry[];
    segments: TokenSegmentSpec[];
    fields?: TokenFieldCatalog;
  }>({
    queryKey: ["/api/bulk-tokens"],
    enabled: open,
  });

  const { data: participantsData } = useQuery<ParticipantRow[]>({
    queryKey: ["/api/bulk-messages", messageId, "participants"],
    enabled: open,
  });
  const seen = new Set<string>();
  const participants = (participantsData || []).filter((p) => {
    if (!p.contactId || seen.has(p.contactId)) return false;
    seen.add(p.contactId);
    return true;
  });

  const fetchPreview = async (v: Record<string, string>): Promise<StudioPreviewResult> => {
    const payload: Record<string, unknown> = {
      fields: previewFieldsFor ? previewFieldsFor(v) : v,
      escapeHtmlFields,
    };
    if (contactId !== "__sample__") payload.contactId = contactId;
    const result = (await apiRequest(
      "POST",
      `/api/bulk-messages/${messageId}/preview`,
      payload,
    )) as BulkPreviewResponse;
    const out: Record<string, { rendered: string; unknownTokens: string[]; missingValues: string[] }> = {};
    for (const [key, r] of Object.entries(result.rendered)) {
      out[key] = {
        rendered: r.output,
        unknownTokens: r.unknownTokens,
        missingValues: r.missingValues,
      };
    }
    return { sample: result.sample, fields: out };
  };

  const contextPanel = (
    <div className="space-y-1.5" data-testid="studio-context-panel">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Preview with
      </p>
      <select
        className="h-9 w-full rounded-md border bg-background px-2 text-sm"
        value={contactId}
        onChange={(e) => setContactId(e.target.value)}
        data-testid="select-studio-preview-recipient"
      >
        <option value="__sample__">Sample data</option>
        {participants.map((p) => {
          const label =
            p.contactDisplayName ||
            `${p.contactGiven || ""} ${p.contactFamily || ""}`.trim() ||
            p.contactId;
          return (
            <option key={p.id} value={p.contactId}>
              {label}
            </option>
          );
        })}
      </select>
      <p className="text-xs text-muted-foreground">
        Real-data previews use this message's participants.
      </p>
    </div>
  );

  return (
    <TemplateStudio
      open={open}
      onOpenChange={onOpenChange}
      title={title}
      description="Edit the message with a live preview. Changes apply to the compose form; save the message to persist them."
      channel={channel}
      fields={fields}
      values={values}
      onValueChange={onValueChange}
      tokens={tokenData?.tokens ?? []}
      segments={tokenData?.segments}
      fieldCatalog={tokenData?.fields}
      fetchPreview={fetchPreview}
      previewContextKey={contactId}
      contextPanel={contextPanel}
    />
  );
}

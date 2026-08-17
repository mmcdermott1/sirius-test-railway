import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Maximize2 } from "lucide-react";
import {
  TemplateStudio,
  type StudioChannel,
  type StudioField,
} from "./TemplateStudio";
import type {
  TokenCatalogEntry,
  TokenFieldCatalog,
  TokenSegmentSpec,
} from "@shared/tokens";

interface TokenStudioCatalog {
  eventEntityKind?: string | null;
  segments: TokenSegmentSpec[];
  fields?: TokenFieldCatalog;
  tokens: TokenCatalogEntry[];
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
  /** Registered template surface the values belong to. */
  surfaceId: string;
  /** Surface-specific parameters (e.g. which medium is being edited). */
  surfaceParams?: Record<string, unknown>;
  /** Optional event entity kind rooting `{{event.*}}` tokens. */
  eventEntityKind?: string;
  /** Token catalog endpoint (defaults to the generic studio catalog). */
  catalogUrl?: string;
  /** Scopes listed first in the token browser. */
  priorityScopes?: string[];
}

/**
 * THE generic token-editing popup: any tokenized string field anywhere
 * can open this. It loads a token catalog and hands it to the shared
 * studio, which previews through the single preview route for the
 * surface id given here. What the preview renders against (sample
 * personas, or the real records this surface offers) is decided
 * server-side, so no host has to arrange it.
 *
 * A surface only needs its own host when it has editor-side logic of its
 * own (the event notifier's default-vs-override text); previewing never
 * requires one.
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
  surfaceId,
  surfaceParams,
  eventEntityKind,
  catalogUrl,
  priorityScopes,
}: TokenStudioProps) {
  const url =
    catalogUrl ??
    (eventEntityKind
      ? `/api/token-studio/catalog?event=${encodeURIComponent(eventEntityKind)}`
      : "/api/token-studio/catalog");
  const { data: catalog } = useQuery<TokenStudioCatalog>({
    queryKey: [url],
    enabled: open,
  });

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
      surfaceId={surfaceId}
      surfaceParams={
        eventEntityKind ? { ...surfaceParams, eventEntityKind } : surfaceParams
      }
      tokens={catalog?.tokens ?? []}
      segments={catalog?.segments}
      fieldCatalog={catalog?.fields}
      priorityScopes={priorityScopes}
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

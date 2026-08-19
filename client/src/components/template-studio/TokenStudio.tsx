import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Maximize2 } from "lucide-react";
import {
  TemplateStudio,
  type StudioChannel,
  type StudioContext,
  type StudioField,
} from "./TemplateStudio";
import type { DeliveryFieldSpec } from "@shared/delivery-fields";
import type {
  TokenCatalogEntry,
  TokenFieldCatalog,
  TokenSegmentSpec,
} from "@shared/tokens";

// A host declares its fields; it should not have to reach past this
// entry point into the studio's internals to name their type.
export type { StudioChannel, StudioField } from "./TemplateStudio";

interface TokenStudioCatalog {
  rootNames?: string[];
  segments: TokenSegmentSpec[];
  fields?: TokenFieldCatalog;
  tokens: TokenCatalogEntry[];
  /** What each root may be previewed as — records and personas. */
  studioContext?: StudioContext;
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
   * How delivery shapes each field, from the shared delivery
   * declarations. Omit for an ad-hoc tokenized field with no delivery
   * composition of its own: each editor's mode then decides plain text
   * vs HTML, which is exactly what such a field gets.
   */
  fieldSpecs?: DeliveryFieldSpec[];
  /** Finished template strings, when they differ from the editor values. */
  templateValues?: Record<string, string>;
  /**
   * Named record roots this host seeds (`dispatch`, `event`, …). Roots
   * not named here don't exist for these tokens.
   */
  rootNames?: string[];
  /** Token catalog endpoint (defaults to the generic studio catalog). */
  catalogUrl?: string;
  /**
   * Browsable-tree endpoints for this host (defaults to the studio's
   * own). Hosts gated differently — bulk messaging — serve the same
   * tree behind their own gate and pass it here.
   */
  treeBaseUrl?: string;
}

/**
 * THE generic token-editing popup: any tokenized string field anywhere
 * can open this, with no registration step of any kind. It loads a
 * token catalog and hands it to the shared studio, which previews
 * through the single preview route — the request carries the field
 * shaping and the template text, so nothing has to be declared
 * server-side for a new field to work.
 *
 * A caller only needs its own host when it has editor-side logic of its
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
  fieldSpecs,
  templateValues,
  rootNames,
  catalogUrl,
  treeBaseUrl,
}: TokenStudioProps) {
  const roots = rootNames?.length ? rootNames : undefined;
  const url =
    catalogUrl ??
    (roots
      ? `/api/token-studio/catalog?roots=${encodeURIComponent(roots.join(","))}`
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
      fieldSpecs={fieldSpecs}
      templateValues={templateValues}
      tokens={catalog?.tokens ?? []}
      segments={catalog?.segments}
      fieldCatalog={catalog?.fields}
      rootNames={roots}
      studioContext={catalog?.studioContext}
      treeBaseUrl={treeBaseUrl}
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

import { useState, useMemo, useEffect, useRef } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WidgetProps } from "@rjsf/utils";
import {
  AlertTriangle,
  Eye,
  EyeOff,
  Loader2,
  Pencil,
  RotateCcw,
} from "lucide-react";
import {
  analyzeTemplateTokens,
  type TokenSegmentSpec,
  type TokenFieldCatalog,
} from "@shared/tokens";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SimpleHtmlEditor } from "@/components/ui/simple-html-editor";
import { Button } from "@/components/ui/button";

interface TokenCatalogResponse {
  eventEntityKind: string;
  segments: TokenSegmentSpec[];
  fields?: TokenFieldCatalog;
  defaults?: Record<string, Record<string, string>>;
}

interface FieldPreview {
  rendered: string;
  unknownTokens: string[];
  missingValues: string[];
}

interface PreviewResponse {
  sample: boolean;
  contactId: string | null;
  channels: {
    email?: { subject: FieldPreview; bodyHtml: FieldPreview };
    sms?: { message: FieldPreview };
    inapp?: {
      title: FieldPreview;
      body: FieldPreview;
      linkUrl?: FieldPreview;
      linkLabel?: FieldPreview;
    };
  };
}

/** Read "email.subject"-style paths out of the defaults payload. */
function defaultAtPath(
  defaults: Record<string, Record<string, string>> | undefined,
  path: string | undefined,
): string {
  if (!defaults || !path) return "";
  const [channel, field] = path.split(".");
  const v = channel && field ? defaults[channel]?.[field] : undefined;
  return typeof v === "string" ? v : "";
}

/**
 * Extract the pluginId from a token-catalog URL such as
 * `/api/event-notifier/token-catalog/my-plugin-id`.
 */
function pluginIdFromCatalogUrl(catalogUrl: string): string | null {
  const match = catalogUrl.match(/\/token-catalog\/([^/?]+)/);
  return match ? match[1] : null;
}

/**
 * Resolve a "channel.field" path (e.g. "email.subject") into the rendered
 * value from a preview response.
 */
function fieldFromPreview(
  preview: PreviewResponse,
  defaultPath: string | undefined,
): FieldPreview | null {
  if (!defaultPath) return null;
  const [channel, field] = defaultPath.split(".");
  if (!channel || !field) return null;
  const ch = preview.channels[channel as keyof typeof preview.channels] as
    | Record<string, FieldPreview>
    | undefined;
  return ch?.[field] ?? null;
}

/**
 * Token-template editor for event-notifier config forms. Renders a
 * single-line input, textarea, or HTML editor (per `x-token-template-mode`),
 * validates the tokens in the value against the notifier's segment
 * graph (from `x-token-catalog-url`) live, and shows the notifier's
 * default template as the placeholder — a blank field means "use the
 * default", so clearing the field is the reset.
 *
 * When the admin expands the preview section the current template (or the
 * default, when blank) is rendered server-side against a sample event entity
 * so they can see the final output before saving.
 */
export function TokenTemplateWidget(props: WidgetProps) {
  const { id, value, onChange, disabled, readonly, options, registry } = props;
  const catalogUrl = typeof options.catalogUrl === "string" ? options.catalogUrl : "";
  const mode = typeof options.mode === "string" ? options.mode : "line";
  const defaultPath =
    typeof options.defaultPath === "string" ? options.defaultPath : undefined;

  // Defaults can depend on other config fields (x-token-defaults-deps
  // names them, e.g. ["recipientKind"]). Read those from the live form
  // data (via formContext) and pass them to the catalog endpoint so the
  // placeholders show the defaults dispatch would actually use. The
  // query key includes only this small subset, so it refetches only
  // when a dependency actually changes.
  const configData =
    (registry?.formContext as { configData?: Record<string, unknown> } | undefined)
      ?.configData ?? {};
  const deps = Array.isArray(options.defaultsDeps)
    ? (options.defaultsDeps as unknown[]).filter((d): d is string => typeof d === "string")
    : [];
  const depValues: Record<string, unknown> = {};
  for (const dep of deps) {
    if (configData[dep] !== undefined) depValues[dep] = configData[dep];
  }
  const depQuery =
    Object.keys(depValues).length > 0
      ? `?config=${encodeURIComponent(JSON.stringify(depValues))}`
      : "";

  const { data } = useQuery<TokenCatalogResponse>({
    queryKey: [catalogUrl + depQuery],
    enabled: !!catalogUrl,
  });

  const text = typeof value === "string" ? value : "";
  // Mirror the server's `pick()` semantics: a whitespace-only value is
  // NOT an override — dispatch will still use the default.
  const hasOverride = text.trim() !== "";
  const placeholder = defaultAtPath(data?.defaults, defaultPath);
  const { invalid } = analyzeTemplateTokens(text, data?.segments || [], data?.fields);
  // Until the segment graph loads, don't flag anything.
  const unknown = data?.segments ? invalid : [];
  const isDisabled = disabled || readonly;

  // ── Preview ────────────────────────────────────────────────────────────────
  const [previewOpen, setPreviewOpen] = useState(false);
  const pluginId = useMemo(() => pluginIdFromCatalogUrl(catalogUrl), [catalogUrl]);

  // Debounce the live configData so the preview endpoint is not called on
  // every keystroke — wait 400 ms after the last change before firing.
  const configDataJson = JSON.stringify(configData);
  const [debouncedConfigJson, setDebouncedConfigJson] = useState(configDataJson);
  const debounceTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!previewOpen) return;
    if (debounceTimer.current) clearTimeout(debounceTimer.current);
    debounceTimer.current = setTimeout(() => {
      setDebouncedConfigJson(configDataJson);
    }, 400);
    return () => {
      if (debounceTimer.current) clearTimeout(debounceTimer.current);
    };
  }, [configDataJson, previewOpen]);

  // When the panel is first opened, show the current config immediately.
  useEffect(() => {
    if (previewOpen) setDebouncedConfigJson(configDataJson);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previewOpen]);

  // POST the configData in the request body — avoids browser/proxy URL-length
  // limits that would truncate large HTML email body templates if sent as a
  // query parameter.
  const previewPostUrl = pluginId ? `/api/event-notifier/preview/${pluginId}` : null;

  const { data: previewData, isFetching: previewLoading, error: previewError } =
    useQuery<PreviewResponse>({
      queryKey: ["event-notifier-preview", pluginId, debouncedConfigJson],
      enabled: previewOpen && !!previewPostUrl,
      staleTime: 0,
      queryFn: async () => {
        const res = await fetch(previewPostUrl!, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ configData: JSON.parse(debouncedConfigJson) }),
          credentials: "include",
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error((body as { message?: string }).message ?? `Preview failed (${res.status})`);
        }
        return res.json() as Promise<PreviewResponse>;
      },
    });

  const previewField = previewData ? fieldFromPreview(previewData, defaultPath) : null;
  const isHtml = mode === "html";

  return (
    <div className="space-y-1.5">
      {mode === "html" ? (
        <SimpleHtmlEditor
          data-testid={`editor-${id}`}
          value={text}
          onChange={(v: string) => onChange(v)}
          disabled={isDisabled}
          placeholder={placeholder || undefined}
        />
      ) : mode === "multiline" ? (
        <Textarea
          id={id}
          data-testid={`input-${id}`}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          disabled={isDisabled}
          placeholder={placeholder || undefined}
          rows={3}
        />
      ) : (
        <Input
          id={id}
          data-testid={`input-${id}`}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          disabled={isDisabled}
          placeholder={placeholder || undefined}
        />
      )}
      {placeholder && !hasOverride && (
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">
            Blank — the default shown above is used.
          </p>
          {!isDisabled && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground gap-1"
              data-testid={`button-edit-default-${id}`}
              onClick={() => onChange(placeholder)}
            >
              <Pencil className="h-3 w-3" />
              Edit default
            </Button>
          )}
        </div>
      )}
      {placeholder && hasOverride && (
        <div className="flex items-center gap-2">
          <p className="text-xs text-muted-foreground">
            {text === placeholder
              ? "Fixed copy of the default — future default changes won't apply."
              : "Custom template."}
          </p>
          {!isDisabled && (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground gap-1"
              data-testid={`button-reset-default-${id}`}
              onClick={() => onChange("")}
            >
              <RotateCcw className="h-3 w-3" />
              Reset to default
            </Button>
          )}
        </div>
      )}
      {unknown.length > 0 && (
        <div
          className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
          data-testid={`text-token-unknown-${id}`}
        >
          <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
          <span>
            <span className="font-medium">Invalid tokens:</span>{" "}
            {unknown.map((t) => `{{${t.expr}}} (${t.error})`).join(", ")} — these
            will render as "[unknown token: …]" when sent.
          </span>
        </div>
      )}

      {/* Preview toggle — only shown for token-templated fields */}
      {pluginId && defaultPath && (
        <div>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground gap-1"
            onClick={() => setPreviewOpen((o) => !o)}
          >
            {previewOpen ? (
              <EyeOff className="h-3 w-3" />
            ) : (
              <Eye className="h-3 w-3" />
            )}
            {previewOpen ? "Hide preview" : "Preview rendered output"}
          </Button>

          {previewOpen && (
            <div
              className="mt-1 rounded-md border bg-muted/40 p-3 text-sm"
              data-testid={`preview-${id}`}
            >
              {previewLoading && (
                <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" />
                  Rendering preview…
                </div>
              )}
              {previewError && !previewLoading && (
                <p className="text-xs text-destructive">
                  Preview unavailable:{" "}
                  {previewError instanceof Error
                    ? previewError.message
                    : "Unknown error"}
                </p>
              )}
              {previewData && !previewLoading && (
                <>
                  {previewField ? (
                    <>
                      {isHtml ? (
                        <div
                          className="prose prose-sm max-w-none dark:prose-invert"
                          // The server sanitizes HTML before returning it in
                          // the preview; treating it as safe here is intentional.
                          // eslint-disable-next-line react/no-danger
                          dangerouslySetInnerHTML={{ __html: previewField.rendered }}
                        />
                      ) : (
                        <p className="whitespace-pre-wrap break-words font-mono text-xs leading-relaxed">
                          {previewField.rendered || (
                            <span className="text-muted-foreground italic">(empty)</span>
                          )}
                        </p>
                      )}
                      {previewField.missingValues.length > 0 && (
                        <p className="mt-1.5 text-xs text-muted-foreground">
                          <span className="font-medium">Sample values used:</span>{" "}
                          {previewField.missingValues.map((t) => `{{${t}}}`).join(", ")}
                        </p>
                      )}
                      {previewField.unknownTokens.length > 0 && (
                        <div className="mt-1.5 flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
                          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
                          <span>
                            <span className="font-medium">Invalid tokens in preview:</span>{" "}
                            {previewField.unknownTokens.map((t) => `{{${t}}}`).join(", ")}
                          </span>
                        </div>
                      )}
                    </>
                  ) : (
                    <p className="text-xs text-muted-foreground italic">
                      No preview available for this field.
                    </p>
                  )}
                  {previewData.sample && (
                    <p className="mt-2 text-xs text-muted-foreground border-t pt-1.5">
                      Rendered with sample data — actual values depend on the
                      recipient and event.
                    </p>
                  )}
                </>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

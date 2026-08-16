import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import type { WidgetProps } from "@rjsf/utils";
import { Maximize2, RotateCcw } from "lucide-react";
import type {
  TokenCatalogEntry,
  TokenFieldCatalog,
  TokenSegmentSpec,
} from "@shared/tokens";
import { Button } from "@/components/ui/button";
import { NotifierTemplateStudio } from "@/components/template-studio/NotifierTemplateStudio";

interface TokenCatalogResponse {
  eventEntityKind: string;
  segments: TokenSegmentSpec[];
  fields?: TokenFieldCatalog;
  defaults?: Record<string, Record<string, string>>;
  tokens?: TokenCatalogEntry[];
  realRecordPreview?: boolean;
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

/** Return the first non-empty line of a string, truncated to maxLen chars. */
function firstLineTruncated(text: string, maxLen = 80): string {
  const firstLine = text.split("\n").find((l) => l.trim()) ?? text;
  return firstLine.length > maxLen ? firstLine.slice(0, maxLen) + "…" : firstLine;
}

/**
 * Token-template widget — compact, read-only summary + "Open in Template Studio".
 *
 * Each token field shows:
 *   - A single truncated line of the current raw value (or a subtle "Using
 *     default: …" indicator when blank).
 *   - An "Open in Template Studio" button as the ONLY edit path.
 *   - A small "Reset to default" affordance when there is a custom override.
 *
 * The inline editor, "Edit default" toggle, and per-field preview have all
 * been removed — preview lives inside the Studio.
 */
export function TokenTemplateWidget(props: WidgetProps) {
  const { id, value, onChange, disabled, readonly, options, registry } = props;
  const catalogUrl = typeof options.catalogUrl === "string" ? options.catalogUrl : "";
  const defaultPath =
    typeof options.defaultPath === "string" ? options.defaultPath : undefined;

  // Defaults can depend on other config fields. Read those from the live form
  // data (via formContext) and pass them to the catalog endpoint.
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
  const isDisabled = disabled || readonly;

  // ── Template Studio (full-screen editor) ──────────────────────────────────
  const [studioOpen, setStudioOpen] = useState(false);
  const pluginId = useMemo(() => pluginIdFromCatalogUrl(catalogUrl), [catalogUrl]);
  const channel = defaultPath?.split(".")[0];
  const updateConfigData = (
    registry?.formContext as
      | { updateConfigData?: (path: string, value: unknown) => void }
      | undefined
  )?.updateConfigData;
  const canOpenStudio = !!pluginId && !!channel && !!updateConfigData && !isDisabled;

  // ── Compact summary display ───────────────────────────────────────────────
  const summaryText: string = hasOverride
    ? firstLineTruncated(text)
    : placeholder
      ? `Using default: ${firstLineTruncated(placeholder)}`
      : "No template set";
  const summaryIsDefault = !hasOverride;

  return (
    <div className="space-y-1" data-testid={`token-field-${id}`}>
      {/* Read-only summary line */}
      <div
        className={`flex items-center gap-2 min-h-[2rem] rounded-md border px-3 py-1.5 text-sm bg-muted/30 ${
          summaryIsDefault ? "text-muted-foreground" : "text-foreground"
        }`}
        data-testid={`summary-${id}`}
      >
        <span className="flex-1 truncate font-mono text-xs leading-5">
          {summaryText}
        </span>

        {/* Reset affordance — only when there is an active override */}
        {hasOverride && !isDisabled && (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="h-5 px-1 text-xs text-muted-foreground hover:text-foreground shrink-0 gap-1"
            data-testid={`button-reset-default-${id}`}
            onClick={() => onChange("")}
            title="Reset to default"
          >
            <RotateCcw className="h-3 w-3" />
            Reset
          </Button>
        )}
      </div>

      {/* Studio button — the only edit path */}
      {canOpenStudio && (
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="h-6 px-1.5 text-xs text-muted-foreground hover:text-foreground gap-1"
          data-testid={`button-open-studio-${id}`}
          onClick={() => setStudioOpen(true)}
        >
          <Maximize2 className="h-3 w-3" />
          Open in Template Studio
        </Button>
      )}

      {canOpenStudio && studioOpen && (
        <NotifierTemplateStudio
          open={studioOpen}
          onOpenChange={setStudioOpen}
          pluginId={pluginId!}
          channel={channel!}
          catalog={data}
          configData={configData}
          updateConfigData={updateConfigData!}
        />
      )}
    </div>
  );
}

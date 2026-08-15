import { useQuery } from "@tanstack/react-query";
import type { WidgetProps } from "@rjsf/utils";
import { AlertTriangle } from "lucide-react";
import {
  analyzeTemplateTokens,
  type TokenSegmentSpec,
  type TokenFieldCatalog,
} from "@shared/tokens";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { SimpleHtmlEditor } from "@/components/ui/simple-html-editor";

interface TokenCatalogResponse {
  eventEntityKind: string;
  segments: TokenSegmentSpec[];
  fields?: TokenFieldCatalog;
  defaults?: Record<string, Record<string, string>>;
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
 * Token-template editor for event-notifier config forms. Renders a
 * single-line input, textarea, or HTML editor (per `x-token-template-mode`),
 * validates the tokens in the value against the notifier's segment
 * graph (from `x-token-catalog-url`) live, and shows the notifier's
 * default template as the placeholder — a blank field means "use the
 * default", so clearing the field is the reset.
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
  const placeholder = defaultAtPath(data?.defaults, defaultPath);
  const { invalid } = analyzeTemplateTokens(text, data?.segments || [], data?.fields);
  // Until the segment graph loads, don't flag anything.
  const unknown = data?.segments ? invalid : [];
  const isDisabled = disabled || readonly;

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
      {placeholder && !text && (
        <p className="text-xs text-muted-foreground">
          Blank — the default shown above is used.
        </p>
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
    </div>
  );
}

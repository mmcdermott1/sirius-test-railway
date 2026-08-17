import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import {
  SimpleHtmlEditor,
  type SimpleHtmlEditorApi,
} from "@/components/ui/simple-html-editor";
import { TokenBrowserPanel } from "@/components/bulk/TokenPicker";
import { cn } from "@/lib/utils";
import { AlertTriangle, Bell, Braces, Loader2 } from "lucide-react";
import {
  analyzeTemplateTokens,
  type TokenCatalogEntry,
  type TokenFieldCatalog,
  type TokenSegmentSpec,
} from "@shared/tokens";

// ─────────────────────────────────────────────────────────────────────────────
// Public types
// ─────────────────────────────────────────────────────────────────────────────

export type StudioFieldMode = "line" | "multiline" | "html";

export interface StudioField {
  /** Key into values / preview results (e.g. "subject", "bodyHtml"). */
  key: string;
  label: string;
  mode: StudioFieldMode;
  /** Optional helper text under the editor. */
  hint?: string;
  /** Default template shown as placeholder for non-HTML fields. */
  placeholder?: string;
}

export interface StudioPreviewField {
  rendered: string;
  unknownTokens: string[];
  missingValues: string[];
  /**
   * Tokens that contributed nothing to the output. Distinct from
   * `missingValues` (which rendered a sample/default): these leave an
   * invisible hole the admin would otherwise ship unnoticed.
   */
  emptyValues: string[];
}

export type StudioChannel = "email" | "sms" | "inapp" | "postal" | "generic";

export interface StudioPreviewResult {
  /** True when rendered purely from sample/example data. */
  sample: boolean;
  /** Per-field rendered output keyed by StudioField.key. */
  fields: Record<string, StudioPreviewField>;
  /** Extra rendered fields not edited here (e.g. inapp linkLabel). */
  extras?: Record<string, StudioPreviewField>;
}

export interface TemplateStudioProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  description?: string;
  channel: StudioChannel;
  fields: StudioField[];
  values: Record<string, string>;
  onValueChange: (key: string, value: string) => void;
  /** Token browser entries. */
  tokens: TokenCatalogEntry[];
  /** Segment graph for live token validation (omit to skip validation). */
  segments?: TokenSegmentSpec[];
  fieldCatalog?: TokenFieldCatalog;
  /** Scopes listed first in the token browser (e.g. ["event"]). */
  priorityScopes?: string[];
  /**
   * Host-supplied preview call: renders the given field values (plus
   * whatever context the host tracks) and returns per-field output.
   */
  fetchPreview: (values: Record<string, string>) => Promise<StudioPreviewResult>;
  /**
   * Identity of the preview context (sample vs. specific record and
   * recipient). Changing it re-renders the preview immediately.
   */
  previewContextKey?: string;
  /** Host-rendered context builder UI (sample / real record pickers). */
  contextPanel?: React.ReactNode;
}

// ─────────────────────────────────────────────────────────────────────────────
// Cursor tracking + insert-at-cursor for line/multiline fields
// ─────────────────────────────────────────────────────────────────────────────

type PlainTarget = HTMLInputElement | HTMLTextAreaElement;

interface ActiveEditorRef {
  key: string;
  kind: "plain" | "html";
  el?: PlainTarget;
  htmlApi?: React.MutableRefObject<SimpleHtmlEditorApi | null>;
}

function SmsPreviewBubble({ text }: { text: string }) {
  const count = text.length;
  const segments = count === 0 ? 0 : Math.ceil(count / 160);
  return (
    <div className="space-y-2">
      <div className="flex justify-start">
        <div
          className="max-w-[85%] rounded-2xl rounded-bl-sm bg-primary text-primary-foreground px-4 py-2 text-sm whitespace-pre-wrap break-words"
          data-testid="studio-preview-sms-bubble"
        >
          {text || <span className="italic opacity-70">(empty message)</span>}
        </div>
      </div>
      <p className="text-xs text-muted-foreground text-right" data-testid="studio-preview-sms-count">
        {count} characters · {segments} SMS segment{segments === 1 ? "" : "s"}
      </p>
    </div>
  );
}

function InappPreviewCard({
  title,
  body,
  linkUrl,
  linkLabel,
}: {
  title: string;
  body: string;
  linkUrl?: string;
  linkLabel?: string;
}) {
  return (
    <div className="rounded-lg border bg-background shadow-sm p-3 space-y-1.5" data-testid="studio-preview-inapp-card">
      <div className="flex items-start gap-2">
        <span className="mt-0.5 rounded-full bg-primary/10 p-1.5 text-primary shrink-0">
          <Bell className="h-3.5 w-3.5" />
        </span>
        <div className="min-w-0">
          <p className="text-sm font-medium break-words">
            {title || <span className="italic text-muted-foreground">(no title)</span>}
          </p>
          <p className="text-sm text-muted-foreground whitespace-pre-wrap break-words">
            {body || <span className="italic">(no body)</span>}
          </p>
          {linkUrl ? (
            <p className="mt-1">
              <span className="text-sm text-primary underline underline-offset-2" title={linkUrl}>
                {linkLabel || linkUrl}
              </span>
              <span className="ml-2 text-xs text-muted-foreground font-mono break-all">{linkUrl}</span>
            </p>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function FieldIssues({ field }: { field: StudioPreviewField | undefined }) {
  if (!field) return null;
  return (
    <>
      {field.missingValues.length > 0 && (
        <p className="text-xs text-muted-foreground">
          <span className="font-medium">Sample/default values used:</span>{" "}
          {field.missingValues.map((t) => `{{${t}}}`).join(", ")}
        </p>
      )}
      {field.emptyValues.length > 0 && (
        <div
          className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400"
          data-testid="studio-preview-empty-tokens"
        >
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            <span className="font-medium">Rendered nothing:</span>{" "}
            {field.emptyValues.map((t) => `{{${t}}}`).join(", ")} — these leave a
            gap in the message, not a blank value.
          </span>
        </div>
      )}
      {field.unknownTokens.length > 0 && (
        <div className="flex items-start gap-1 text-xs text-amber-700 dark:text-amber-400">
          <AlertTriangle className="h-3 w-3 mt-0.5 shrink-0" />
          <span>
            <span className="font-medium">Invalid tokens:</span>{" "}
            {field.unknownTokens.map((t) => `{{${t}}}`).join(", ")}
          </span>
        </div>
      )}
    </>
  );
}

/**
 * Near-fullscreen tokenized-template editor: editors on the left, a
 * debounced live server-rendered preview + token browser + host-supplied
 * context builder on the right. Channel-aware preview: email renders the
 * composed subject + body, SMS a character-counted bubble, in-app a mock
 * notification card.
 */
export function TemplateStudio({
  open,
  onOpenChange,
  title,
  description,
  channel,
  fields,
  values,
  onValueChange,
  tokens,
  segments,
  fieldCatalog,
  priorityScopes,
  fetchPreview,
  previewContextKey = "",
  contextPanel,
}: TemplateStudioProps) {
  const activeEditorRef = useRef<ActiveEditorRef | null>(null);
  const htmlApiRefs = useRef<Record<string, React.MutableRefObject<SimpleHtmlEditorApi | null>>>({});
  const getHtmlApiRef = (key: string) => {
    if (!htmlApiRefs.current[key]) {
      htmlApiRefs.current[key] = { current: null };
    }
    return htmlApiRefs.current[key];
  };

  // ── Debounced preview ──────────────────────────────────────────────────────
  const valuesJson = JSON.stringify(values);
  const [debouncedJson, setDebouncedJson] = useState(valuesJson);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!open) return;
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(() => setDebouncedJson(valuesJson), 500);
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, [valuesJson, open]);
  useEffect(() => {
    if (open) setDebouncedJson(valuesJson);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, previewContextKey]);

  const {
    data: preview,
    isFetching: previewLoading,
    error: previewError,
  } = useQuery<StudioPreviewResult>({
    queryKey: ["template-studio-preview", title, channel, previewContextKey, debouncedJson],
    enabled: open,
    staleTime: 0,
    queryFn: () => fetchPreview(JSON.parse(debouncedJson) as Record<string, string>),
  });

  // ── Token insertion ────────────────────────────────────────────────────────
  const insertSnippet = useCallback(
    (snippet: string) => {
      const active = activeEditorRef.current ?? {
        key: fields[0]?.key,
        kind: fields[0]?.mode === "html" ? ("html" as const) : ("plain" as const),
      };
      if (!active?.key) return;
      if (active.kind === "html") {
        getHtmlApiRef(active.key).current?.insertText(snippet);
        return;
      }
      const el = active.el;
      const current = values[active.key] ?? "";
      const start = el?.selectionStart ?? current.length;
      const end = el?.selectionEnd ?? current.length;
      const next = current.slice(0, start) + snippet + current.slice(end);
      onValueChange(active.key, next);
      requestAnimationFrame(() => {
        if (!el) return;
        el.focus();
        const caret = start + snippet.length;
        try {
          el.setSelectionRange(caret, caret);
        } catch {
          /* noop */
        }
      });
    },
    [fields, values, onValueChange],
  );

  // ── Validation ─────────────────────────────────────────────────────────────
  const invalidByField = useMemo(() => {
    const out: Record<string, Array<{ expr: string; error: string }>> = {};
    if (!segments) return out;
    for (const f of fields) {
      const { invalid } = analyzeTemplateTokens(values[f.key] ?? "", segments, fieldCatalog);
      if (invalid.length > 0) out[f.key] = invalid;
    }
    return out;
  }, [fields, values, segments, fieldCatalog]);

  // ── Preview body per channel ───────────────────────────────────────────────
  const pf = (key: string): StudioPreviewField | undefined =>
    preview?.fields[key] ?? preview?.extras?.[key];

  const renderPreviewBody = () => {
    if (!preview) return null;
    if (channel === "email") {
      const subject = pf("subject");
      const body = pf("bodyHtml");
      return (
        <div className="rounded-lg border bg-background shadow-sm overflow-hidden" data-testid="studio-preview-email">
          <div className="border-b px-4 py-2.5 bg-muted/40">
            <p className="text-xs text-muted-foreground uppercase tracking-wide">Subject</p>
            <p className="text-sm font-medium break-words" data-testid="studio-preview-email-subject">
              {subject?.rendered || <span className="italic text-muted-foreground">(no subject — email would not send)</span>}
            </p>
          </div>
          <div
            className="px-4 py-3 prose prose-sm max-w-none dark:prose-invert overflow-x-auto"
            data-testid="studio-preview-email-body"
            // Server-sanitized HTML (same sanitizer as delivery).
            dangerouslySetInnerHTML={{ __html: body?.rendered || "<p><em>(empty body)</em></p>" }}
          />
          <div className="px-4 pb-3 space-y-1">
            <FieldIssues field={subject} />
            <FieldIssues field={body} />
          </div>
        </div>
      );
    }
    if (channel === "sms") {
      const message = pf("message") ?? pf("body");
      return (
        <div className="space-y-1.5">
          <SmsPreviewBubble text={message?.rendered ?? ""} />
          <FieldIssues field={message} />
        </div>
      );
    }
    if (channel === "inapp") {
      const titleF = pf("title");
      const bodyF = pf("body");
      const linkUrlF = pf("linkUrl");
      const linkLabelF = pf("linkLabel");
      return (
        <div className="space-y-1.5">
          <InappPreviewCard
            title={titleF?.rendered ?? ""}
            body={bodyF?.rendered ?? ""}
            linkUrl={linkUrlF?.rendered || undefined}
            linkLabel={linkLabelF?.rendered || undefined}
          />
          <FieldIssues field={titleF} />
          <FieldIssues field={bodyF} />
          <FieldIssues field={linkUrlF} />
        </div>
      );
    }
    if (channel === "postal") {
      // Letter-style sheet: plain rendered text on "paper".
      return (
        <div className="space-y-3">
          {fields.map((f) => {
            const r = pf(f.key);
            return (
              <div key={f.key} className="space-y-1.5">
                {fields.length > 1 && (
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{f.label}</p>
                )}
                <div
                  className="rounded-sm border bg-white dark:bg-neutral-100 text-neutral-900 shadow-sm px-6 py-5 font-serif text-sm leading-relaxed whitespace-pre-wrap break-words min-h-[8rem]"
                  data-testid={`studio-preview-postal-${f.key}`}
                >
                  {r?.rendered || <span className="italic text-neutral-400">(empty)</span>}
                </div>
                <FieldIssues field={r} />
              </div>
            );
          })}
        </div>
      );
    }
    // generic: per-field blocks
    return (
      <div className="space-y-3">
        {fields.map((f) => {
          const r = pf(f.key);
          return (
            <div key={f.key} className="rounded-md border bg-background p-3 space-y-1">
              <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">{f.label}</p>
              {f.mode === "html" ? (
                <div
                  className="prose prose-sm max-w-none dark:prose-invert overflow-x-auto"
                  dangerouslySetInnerHTML={{ __html: r?.rendered || "<p><em>(empty)</em></p>" }}
                />
              ) : (
                <p className="text-sm whitespace-pre-wrap break-words">
                  {r?.rendered || <span className="italic text-muted-foreground">(empty)</span>}
                </p>
              )}
              <FieldIssues field={r} />
            </div>
          );
        })}
      </div>
    );
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className="max-w-[96vw] sm:max-w-[96vw] lg:max-w-[1400px] h-[92vh] flex flex-col p-0 gap-0"
        data-testid="dialog-template-studio"
      >
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle data-testid="studio-title">{title}</DialogTitle>
          {description && <DialogDescription>{description}</DialogDescription>}
        </DialogHeader>

        <div className="flex-1 min-h-0 grid grid-cols-1 lg:grid-cols-[1fr_minmax(360px,42%)]">
          {/* ── Editors ── */}
          <div className="min-h-0 min-w-0 overflow-y-auto p-6 space-y-5 border-b lg:border-b-0 lg:border-r">
            {fields.map((f) => (
              <div key={f.key} className="space-y-1.5">
                <Label htmlFor={`studio-field-${f.key}`}>{f.label}</Label>
                {f.mode === "html" ? (
                  <div
                    onFocusCapture={() => {
                      activeEditorRef.current = {
                        key: f.key,
                        kind: "html",
                        htmlApi: getHtmlApiRef(f.key),
                      };
                    }}
                  >
                    <SimpleHtmlEditor
                      data-testid={`studio-editor-${f.key}`}
                      value={values[f.key] ?? ""}
                      onChange={(v) => onValueChange(f.key, v)}
                      minHeight={260}
                      enableTokens
                      tokensOverride={tokens}
                      editorApiRef={getHtmlApiRef(f.key)}
                    />
                  </div>
                ) : f.mode === "multiline" ? (
                  <Textarea
                    id={`studio-field-${f.key}`}
                    data-testid={`studio-editor-${f.key}`}
                    value={values[f.key] ?? ""}
                    placeholder={f.placeholder || undefined}
                    onChange={(e) => {
                      onValueChange(f.key, e.target.value);
                      // Auto-grow with content.
                      e.target.style.height = "auto";
                      e.target.style.height = `${e.target.scrollHeight + 2}px`;
                    }}
                    onFocus={(e) => {
                      activeEditorRef.current = { key: f.key, kind: "plain", el: e.currentTarget };
                    }}
                    rows={4}
                    className="min-h-[6rem] resize-y"
                  />
                ) : (
                  <Input
                    id={`studio-field-${f.key}`}
                    data-testid={`studio-editor-${f.key}`}
                    value={values[f.key] ?? ""}
                    placeholder={f.placeholder || undefined}
                    onChange={(e) => onValueChange(f.key, e.target.value)}
                    onFocus={(e) => {
                      activeEditorRef.current = { key: f.key, kind: "plain", el: e.currentTarget };
                    }}
                  />
                )}
                {f.hint && <p className="text-xs text-muted-foreground">{f.hint}</p>}
                {(invalidByField[f.key]?.length ?? 0) > 0 && (
                  <div
                    className="flex items-start gap-1.5 text-xs text-amber-700 dark:text-amber-400"
                    data-testid={`studio-invalid-${f.key}`}
                  >
                    <AlertTriangle className="h-3.5 w-3.5 mt-0.5 shrink-0" />
                    <span>
                      <span className="font-medium">Invalid tokens:</span>{" "}
                      {invalidByField[f.key].map((t) => `{{${t.expr}}} (${t.error})`).join(", ")}
                    </span>
                  </div>
                )}
              </div>
            ))}
            <p className="text-xs text-muted-foreground flex items-center gap-1.5">
              <Braces className="h-3.5 w-3.5" />
              Pick a token on the right to insert it at the cursor of the last edited field.
            </p>
          </div>

          {/* ── Preview + context + token browser ── */}
          <div className="min-h-0 min-w-0 flex flex-col">
            <div className="shrink-0 border-b">
              {contextPanel && <div className="px-4 pt-3 pb-2">{contextPanel}</div>}
            </div>
            <div className="min-h-0 flex-1 grid grid-rows-[minmax(0,1fr)_minmax(0,1fr)]">
              <div className="min-h-0 min-w-0 overflow-y-auto overflow-x-hidden p-4 bg-muted/30">
                <div className="flex items-center justify-between mb-2">
                  <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">Live preview</p>
                  {previewLoading && (
                    <span className="flex items-center gap-1 text-xs text-muted-foreground">
                      <Loader2 className="h-3 w-3 animate-spin" /> Rendering…
                    </span>
                  )}
                </div>
                {previewError && !previewLoading ? (
                  <p className="text-xs text-destructive" data-testid="studio-preview-error">
                    Preview unavailable: {previewError instanceof Error ? previewError.message : "Unknown error"}
                  </p>
                ) : (
                  renderPreviewBody()
                )}
                {preview?.sample && (
                  <p className="mt-3 text-xs text-muted-foreground border-t pt-2">
                    Rendered with sample data — actual values depend on the recipient and record.
                  </p>
                )}
              </div>
              <div className={cn("min-h-0 min-w-0 border-t flex flex-col overflow-hidden")}>
                <TokenBrowserPanel
                  tokens={tokens}
                  onInsert={insertSnippet}
                  priorityScopes={priorityScopes}
                />
              </div>
            </div>
          </div>
        </div>

        <div className="px-6 py-3 border-t shrink-0 flex justify-end">
          <Button onClick={() => onOpenChange(false)} data-testid="button-studio-done">
            Done
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}

import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { RadioGroup, RadioGroupItem } from "@/components/ui/radio-group";
import { Label } from "@/components/ui/label";
import { Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface EntityRef {
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
export function useDebounced(value: string): string {
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
export function SearchPicker({
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

export interface StudioPreviewContext {
  /** Real-record mode is on AND supported. */
  realActive: boolean;
  entity: EntityRef | null;
  recipient: EntityRef | null;
  /** Stable identity of the current context for preview re-rendering. */
  previewContextKey: string;
  /** Ready-to-render context panel (sample/real radio + pickers). */
  contextPanel: React.ReactNode;
}

/**
 * Shared Template Studio preview-context builder: "Sample data" vs
 * "Real record" mode, a record picker (driven by a host-supplied search
 * URL builder) and an optional recipient contact picker. Every Studio
 * host inherits this instead of rolling its own.
 */
export function useStudioPreviewContext({
  open,
  realRecordPreview,
  entitySearchUrl,
  showRecipientPicker = true,
  allowRecipientOnlyReal = false,
}: {
  open: boolean;
  /** Whether a real-record picker is available at all. */
  realRecordPreview: boolean;
  /** Build the record-search URL for a query (host picks the endpoint). */
  entitySearchUrl?: (query: string) => string;
  /** Offer the recipient contact picker in real mode (default true). */
  showRecipientPicker?: boolean;
  /**
   * Allow "Real record" mode with only a recipient contact (no record
   * provider). Off by default: hosts whose tokens are rooted at an event
   * entity render nonsense against an empty event, so real mode requires
   * a record provider unless the host opts in.
   */
  allowRecipientOnlyReal?: boolean;
}): StudioPreviewContext {
  const [mode, setMode] = useState<"sample" | "real">("sample");
  const [entity, setEntity] = useState<EntityRef | null>(null);
  const [recipient, setRecipient] = useState<EntityRef | null>(null);
  const [entityQuery, setEntityQuery] = useState("");
  const [recipientQuery, setRecipientQuery] = useState("");
  const debouncedEntityQuery = useDebounced(entityQuery);
  const debouncedRecipientQuery = useDebounced(recipientQuery);

  const canReal = realRecordPreview || (allowRecipientOnlyReal && showRecipientPicker);
  const realActive = mode === "real" && canReal;

  const { data: entityResults, isFetching: entityLoading } = useQuery<{ entities: EntityRef[] }>({
    queryKey: [entitySearchUrl ? entitySearchUrl(debouncedEntityQuery) : ""],
    enabled: open && realActive && realRecordPreview && !!entitySearchUrl && !entity,
  });

  const { data: contactResults, isFetching: contactLoading } = useQuery<ContactSearchRow[]>({
    queryKey: [`/api/contacts/search?q=${encodeURIComponent(debouncedRecipientQuery)}`],
    enabled:
      open &&
      realActive &&
      showRecipientPicker &&
      !recipient &&
      debouncedRecipientQuery.trim().length >= 2,
  });

  const previewContextKey = realActive
    ? `real:${entity?.id ?? ""}:${recipient?.id ?? ""}`
    : "sample";

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
        <div className={cn("flex items-center gap-1.5", !canReal && "opacity-50")}>
          <RadioGroupItem
            value="real"
            id="studio-ctx-real"
            disabled={!canReal}
            data-testid="radio-context-real"
          />
          <Label htmlFor="studio-ctx-real" className="text-sm font-normal">
            Real record
          </Label>
        </div>
      </RadioGroup>
      {realActive && (
        <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
          {realRecordPreview && entitySearchUrl && (
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
          )}
          {showRecipientPicker && (
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
          )}
        </div>
      )}
      {realActive && realRecordPreview && !entity && (
        <p className="text-xs text-muted-foreground">
          Pick a record to render the preview with its real data.
        </p>
      )}
    </div>
  );

  return { realActive, entity, recipient, previewContextKey, contextPanel };
}

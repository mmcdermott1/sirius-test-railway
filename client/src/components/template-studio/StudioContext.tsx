import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Input } from "@/components/ui/input";
import { Search } from "lucide-react";

export interface EntityRef {
  id: string;
  label: string;
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

/**
 * One root the current template's tokens can be rooted at, as reported
 * by the server's token catalog.
 */
export interface StudioPreviewRoot {
  /** Token entity kind ("worker", "contact", "dispatch_job"…). */
  kind: string;
  /** Human label for the kind ("Worker"). */
  label: string;
  /** Whether real records of this kind can be searched and loaded. */
  hasProvider: boolean;
}

export interface StudioPreviewContext {
  /** Picked real record per root kind; unpicked roots render samples. */
  records: Record<string, EntityRef>;
  /** Stable identity of the current context for preview re-rendering. */
  previewContextKey: string;
  /** Ready-to-render context panel (one record picker per root). */
  contextPanel: React.ReactNode;
}

/** Default record-search endpoint for a root kind. */
function defaultSearchUrl(kind: string, query: string): string {
  return `/api/token-studio/preview-entities/${encodeURIComponent(kind)}?q=${encodeURIComponent(query)}`;
}

/** One root's record picker; owns its own query state and search. */
function RootRecordPicker({
  open,
  root,
  searchUrl,
  selected,
  onChange,
}: {
  open: boolean;
  root: StudioPreviewRoot;
  searchUrl: (kind: string, query: string) => string;
  selected: EntityRef | null;
  onChange: (ref: EntityRef | null) => void;
}) {
  const [query, setQuery] = useState("");
  const debounced = useDebounced(query);
  const { data, isFetching } = useQuery<{ entities: EntityRef[] }>({
    queryKey: [searchUrl(root.kind, debounced)],
    enabled: open && !selected,
  });
  return (
    <div className="space-y-1">
      <p className="text-xs text-muted-foreground">{root.label}</p>
      <SearchPicker
        placeholder={`Search ${root.label.toLowerCase()}…`}
        selectedLabel={selected?.label ?? null}
        onClear={() => onChange(null)}
        onQuery={setQuery}
        results={data?.entities ?? []}
        onPick={(r) => onChange(r)}
        loading={isFetching}
        testId={`studio-root-picker-${root.kind}`}
      />
    </div>
  );
}

/**
 * Shared Template Studio preview-context builder: one record picker per
 * root the current template can reach that has a real-record provider.
 * Every Studio host inherits this instead of rolling its own — a root is
 * previewed against a real record when one is picked for it and renders
 * sample values otherwise, so a preview can honestly mix the two.
 */
export function useStudioPreviewContext({
  open,
  previewRoots,
  searchUrl = defaultSearchUrl,
}: {
  open: boolean;
  /** Roots reported by the surface's token catalog. */
  previewRoots?: StudioPreviewRoot[];
  /** Override the record-search endpoint (defaults to the studio's). */
  searchUrl?: (kind: string, query: string) => string;
}): StudioPreviewContext {
  const [records, setRecords] = useState<Record<string, EntityRef>>({});

  const available = (previewRoots ?? []).filter((r) => r.hasProvider);
  const availableKeys = available.map((r) => r.kind).join(",");

  // A root can disappear (the catalog changes with the event kind, a
  // component gets turned off): drop picks that no longer apply so they
  // are not posted with the preview.
  useEffect(() => {
    setRecords((prev) => {
      const kinds = availableKeys ? availableKeys.split(",") : [];
      const next: Record<string, EntityRef> = {};
      for (const kind of kinds) if (prev[kind]) next[kind] = prev[kind];
      return Object.keys(next).length === Object.keys(prev).length ? prev : next;
    });
  }, [availableKeys]);

  const previewContextKey =
    available.map((r) => `${r.kind}:${records[r.kind]?.id ?? ""}`).join("|") ||
    "sample";

  const contextPanel = (
    <div className="space-y-2" data-testid="studio-context-panel">
      <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
        Preview with
      </p>
      {available.length === 0 ? (
        <p className="text-xs text-muted-foreground" data-testid="studio-context-no-roots">
          No real records available for this template — rendering sample data.
        </p>
      ) : (
        <>
          <div className="grid grid-cols-1 xl:grid-cols-2 gap-2">
            {available.map((root) => (
              <RootRecordPicker
                key={root.kind}
                open={open}
                root={root}
                searchUrl={searchUrl}
                selected={records[root.kind] ?? null}
                onChange={(ref) =>
                  setRecords((prev) => {
                    const next = { ...prev };
                    if (ref) next[root.kind] = ref;
                    else delete next[root.kind];
                    return next;
                  })
                }
              />
            ))}
          </div>
          <p className="text-xs text-muted-foreground">
            Pick a record to render with its real values; anything left unpicked
            renders sample data.
          </p>
        </>
      )}
    </div>
  );

  return { records, previewContextKey, contextPanel };
}

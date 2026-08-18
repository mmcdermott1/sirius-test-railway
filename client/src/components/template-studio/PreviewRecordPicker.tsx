import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import {
  Command,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
  CommandSeparator,
} from "@/components/ui/command";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";
import { Check, ChevronsUpDown, Loader2, Search } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * The record an author is previewing against, instead of sample data.
 * `rootName` is the root the record seeds — two roots can share a kind,
 * so the root is part of the choice, not derived from it.
 */
export interface PickedPreviewRecord {
  rootName: string;
  kind: string;
  id: string;
  label: string;
}

/** A root an author may pick a real record for. */
export interface PickableRoot {
  name: string;
  kind: string;
  label: string;
}

interface PreviewRecordRef {
  id: string;
  label: string;
  hint?: string;
}

/**
 * Pick REAL records to preview a template against — one per root.
 *
 * Sample personas stay the default: picking a record is a deliberate
 * act, per root, and clearing a pick returns that root — and only that
 * root — to samples. A template composed of several roots (a grievance
 * plus its settlement) can therefore be made real piece by piece. The
 * search only ever returns records this author may read — the server
 * runs the entity kind's own read gate over every candidate — so an
 * empty result is an honest "nothing you can open matches", not a
 * hidden failure.
 */
export function PreviewRecordPicker({
  roots,
  picked,
  onPick,
}: {
  roots: PickableRoot[];
  /** The record picked for each root, keyed by root NAME. */
  picked: Record<string, PickedPreviewRecord>;
  /** Set (or clear, with null) the pick for ONE root. */
  onPick: (rootName: string, record: PickedPreviewRecord | null) => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [rootName, setRootName] = useState<string>(roots[0]?.name ?? "");

  // The offered roots come from the studio's context (a switched-off
  // component offers none); keep the selection on one that still exists.
  useEffect(() => {
    if (roots.length === 0) return;
    if (!roots.some((r) => r.name === rootName)) {
      setRootName(roots[0].name);
    }
  }, [roots, rootName]);

  const root = roots.find((r) => r.name === rootName) ?? roots[0];

  // Debounced so a search runs per pause, not per keystroke.
  const [debounced, setDebounced] = useState(query);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(t);
  }, [query]);

  const { data, isFetching, error } = useQuery<{ records: PreviewRecordRef[] }>({
    queryKey: ["template-studio-preview-records", root?.kind ?? "", debounced],
    enabled: open && Boolean(root),
    staleTime: 0,
    queryFn: async () => {
      const params = new URLSearchParams({ kind: root!.kind, q: debounced });
      const res = await fetch(
        `/api/template-studio/preview-records?${params.toString()}`,
        { credentials: "include" },
      );
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error(
          (err as { message?: string }).message ??
            `Record search failed (${res.status})`,
        );
      }
      return (await res.json()) as { records: PreviewRecordRef[] };
    },
  });

  if (roots.length === 0) return null;
  const records = data?.records ?? [];
  const pickedForRoot = root ? (picked[root.name] ?? null) : null;

  return (
    <div className="space-y-1.5" data-testid="studio-record-picker">
      {roots.length > 1 && (
        <div className="flex flex-wrap gap-1">
          {roots.map((r) => (
            <Button
              key={r.name}
              type="button"
              size="sm"
              variant={r.name === rootName ? "secondary" : "ghost"}
              className="h-6 px-2 text-xs"
              onClick={() => setRootName(r.name)}
              data-testid={`studio-record-root-${r.name}`}
            >
              {picked[r.name] && <Check className="mr-1 h-3 w-3" />}
              {r.label}
            </Button>
          ))}
        </div>
      )}
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            type="button"
            variant="outline"
            role="combobox"
            aria-expanded={open}
            className="h-8 w-full justify-between text-sm font-normal"
            data-testid="button-studio-record-picker"
          >
            <span className="truncate">
              {pickedForRoot
                ? pickedForRoot.label
                : `Find a real ${root?.label.toLowerCase() ?? "record"}…`}
            </span>
            <ChevronsUpDown className="ml-2 h-3.5 w-3.5 shrink-0 opacity-50" />
          </Button>
        </PopoverTrigger>
        <PopoverContent className="w-[--radix-popover-trigger-width] p-0" align="start">
          <Command shouldFilter={false}>
            <CommandInput
              placeholder={`Search ${root?.label.toLowerCase() ?? "records"}…`}
              value={query}
              onValueChange={setQuery}
              data-testid="input-studio-record-search"
            />
            <CommandList>
              {isFetching && (
                <div className="flex items-center gap-2 px-3 py-2 text-xs text-muted-foreground">
                  <Loader2 className="h-3 w-3 animate-spin" /> Searching…
                </div>
              )}
              {error && !isFetching && (
                <div
                  className="px-3 py-2 text-xs text-destructive"
                  data-testid="studio-record-search-error"
                >
                  {error instanceof Error ? error.message : "Search failed"}
                </div>
              )}
              {!isFetching && !error && (
                <CommandEmpty>
                  <span className="text-xs">
                    No records you can open match that search.
                  </span>
                </CommandEmpty>
              )}
              {records.length > 0 && (
                <CommandGroup heading="Real records">
                  {records.map((record) => (
                    <CommandItem
                      key={record.id}
                      value={record.id}
                      onSelect={() => {
                        onPick(root!.name, {
                          rootName: root!.name,
                          kind: root!.kind,
                          id: record.id,
                          label: record.label,
                        });
                        setOpen(false);
                      }}
                      data-testid={`studio-record-option-${record.id}`}
                    >
                      <Check
                        className={cn(
                          "mr-2 h-3.5 w-3.5",
                          pickedForRoot?.id === record.id ? "opacity-100" : "opacity-0",
                        )}
                      />
                      <span className="min-w-0">
                        <span className="block truncate text-sm">
                          {record.label}
                        </span>
                        {record.hint && (
                          <span className="block truncate text-xs text-muted-foreground">
                            {record.hint}
                          </span>
                        )}
                      </span>
                    </CommandItem>
                  ))}
                </CommandGroup>
              )}
              {pickedForRoot && (
                <>
                  <CommandSeparator />
                  <CommandGroup>
                    <CommandItem
                      value="__sample__"
                      onSelect={() => {
                        onPick(root!.name, null);
                        setOpen(false);
                      }}
                      data-testid="studio-record-clear"
                    >
                      <Search className="mr-2 h-3.5 w-3.5 opacity-50" />
                      Use sample data instead
                    </CommandItem>
                  </CommandGroup>
                </>
              )}
            </CommandList>
          </Command>
        </PopoverContent>
      </Popover>
    </div>
  );
}

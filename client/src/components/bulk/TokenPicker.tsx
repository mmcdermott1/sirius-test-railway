import { useEffect, useState } from "react";
import { Button } from "@/components/ui/button";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Braces } from "lucide-react";
import { TokenTreeBrowser } from "@/components/template-studio/TokenTreeBrowser";

/** Tree endpoints served behind the bulk-messaging gate. */
export const BULK_TOKEN_TREE_URL = "/api/bulk-tokens/tree";

interface TokenPickerProps {
  onInsert: (snippet: string) => void;
  /** Accepted for backward compatibility but no longer used — every token is always shown. */
  messageId?: string;
}

/**
 * Bulk messaging's "Insert token" popover: the same browsable token tree
 * the Template Studio uses, against the roots bulk messaging offers
 * (contact-side records and system values — there is no event here).
 */
export function TokenPicker({ onInsert }: TokenPickerProps) {
  // Always show every registered token — authors should be able to
  // browse the full set regardless of who's currently on the recipient
  // list. Recipient context still controls what each token resolves to
  // at send time.
  const [open, setOpen] = useState(false);
  const [panelKey, setPanelKey] = useState(0);

  useEffect(() => {
    // Remount the panel on open so the walk + search reset.
    if (open) setPanelKey((k) => k + 1);
  }, [open]);

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button type="button" variant="outline" size="sm" data-testid="button-open-token-picker">
          <Braces className="h-4 w-4 mr-1.5" />
          Insert token
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-96 p-0 h-[28rem] flex flex-col" align="end">
        <TokenTreeBrowser
          key={panelKey}
          treeBaseUrl={BULK_TOKEN_TREE_URL}
          onInsert={(snippet) => {
            onInsert(snippet);
            setOpen(false);
          }}
        />
      </PopoverContent>
    </Popover>
  );
}

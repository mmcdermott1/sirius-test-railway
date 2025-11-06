import { useEffect, useRef, useState } from "react";
import { Bold, Italic, List, ListOrdered, Link, Type, Code } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { cn } from "@/lib/utils";

const SPECIAL_CHARACTERS = [
  { name: 'Copyright', symbol: '©' },
  { name: 'Registered', symbol: '®' },
  { name: 'Trademark', symbol: '™' },
  { name: 'Bullet', symbol: '•' },
  { name: 'En dash', symbol: '–' },
  { name: 'Em dash', symbol: '—' },
  { name: 'Left quote', symbol: '\u201C' },
  { name: 'Right quote', symbol: '\u201D' },
  { name: 'Left single quote', symbol: '\u2018' },
  { name: 'Right single quote', symbol: '\u2019' },
  { name: 'Ellipsis', symbol: '…' },
  { name: 'Section', symbol: '§' },
  { name: 'Paragraph', symbol: '¶' },
  { name: 'Degree', symbol: '°' },
];

interface SimpleHtmlEditorProps {
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  className?: string;
  "data-testid"?: string;
}

const ALLOWED_TAGS = ['strong', 'b', 'em', 'i', 'u', 'ul', 'ol', 'li', 'br', 'p', 'a'];
const ALLOWED_ATTRIBUTES: Record<string, string[]> = {
  'a': ['href', 'target', 'rel']
};

function sanitizeHtml(html: string): string {
  const temp = document.createElement('div');
  temp.innerHTML = html;
  
  function cleanNode(node: Node): void {
    if (node.nodeType === Node.ELEMENT_NODE) {
      const element = node as Element;
      const tagName = element.tagName.toLowerCase();
      
      if (!ALLOWED_TAGS.includes(tagName)) {
        while (element.firstChild) {
          element.parentNode?.insertBefore(element.firstChild, element);
        }
        element.remove();
        return;
      }
      
      // Remove all attributes except allowed ones
      const allowedAttrs = ALLOWED_ATTRIBUTES[tagName] || [];
      Array.from(element.attributes).forEach(attr => {
        if (!allowedAttrs.includes(attr.name)) {
          element.removeAttribute(attr.name);
        }
      });
    }
    
    Array.from(node.childNodes).forEach(child => cleanNode(child));
  }
  
  Array.from(temp.childNodes).forEach(child => cleanNode(child));
  return temp.innerHTML;
}

export function SimpleHtmlEditor({ value, onChange, placeholder, className, "data-testid": testId }: SimpleHtmlEditorProps) {
  const editorRef = useRef<HTMLDivElement>(null);
  const [isFocused, setIsFocused] = useState(false);
  const [rawMode, setRawMode] = useState(false);
  const [rawHtml, setRawHtml] = useState(value);

  useEffect(() => {
    if (editorRef.current && !isFocused && !rawMode) {
      const sanitized = sanitizeHtml(value);
      if (editorRef.current.innerHTML !== sanitized) {
        editorRef.current.innerHTML = sanitized;
      }
    }
  }, [value, isFocused, rawMode]);

  useEffect(() => {
    if (!rawMode) {
      setRawHtml(value);
    }
  }, [value, rawMode]);

  const handleInput = () => {
    if (editorRef.current) {
      const sanitized = sanitizeHtml(editorRef.current.innerHTML);
      onChange(sanitized);
    }
  };

  const execCommand = (command: string, value?: string) => {
    document.execCommand(command, false, value);
    editorRef.current?.focus();
    handleInput();
  };

  const handleCreateLink = () => {
    const url = prompt('Enter URL:');
    if (url) {
      execCommand('createLink', url);
    }
  };

  const handleInsertCharacter = (character: string) => {
    document.execCommand('insertHTML', false, character);
    editorRef.current?.focus();
    handleInput();
  };

  const toggleRawMode = () => {
    if (rawMode) {
      // Switching from raw to visual
      onChange(rawHtml);
      setRawMode(false);
    } else {
      // Switching from visual to raw
      setRawHtml(value);
      setRawMode(true);
    }
  };

  const handleRawHtmlChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    const newValue = e.target.value;
    setRawHtml(newValue);
    onChange(newValue);
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      document.execCommand('insertHTML', false, '<br><br>');
      handleInput();
    }
  };

  return (
    <div className={cn("border border-input rounded-md", className)}>
      {/* Toolbar */}
      <div className="flex items-center gap-1 p-2 border-b border-border bg-muted/30">
        {!rawMode && (
          <>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => execCommand('bold')}
              title="Bold"
              data-testid={testId ? `${testId}-bold` : undefined}
            >
              <Bold size={16} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => execCommand('italic')}
              title="Italic"
              data-testid={testId ? `${testId}-italic` : undefined}
            >
              <Italic size={16} />
            </Button>
            <div className="w-px h-6 bg-border mx-1" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => execCommand('insertUnorderedList')}
              title="Bullet List"
              data-testid={testId ? `${testId}-ul` : undefined}
            >
              <List size={16} />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={() => execCommand('insertOrderedList')}
              title="Numbered List"
              data-testid={testId ? `${testId}-ol` : undefined}
            >
              <ListOrdered size={16} />
            </Button>
            <div className="w-px h-6 bg-border mx-1" />
            <Button
              type="button"
              variant="ghost"
              size="sm"
              className="h-8 w-8 p-0"
              onClick={handleCreateLink}
              title="Insert Link"
              data-testid={testId ? `${testId}-link` : undefined}
            >
              <Link size={16} />
            </Button>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  className="h-8 w-8 p-0"
                  title="Special Characters"
                  data-testid={testId ? `${testId}-special` : undefined}
                >
                  <Type size={16} />
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent>
                {SPECIAL_CHARACTERS.map((char) => (
                  <DropdownMenuItem
                    key={char.symbol}
                    onClick={() => handleInsertCharacter(char.symbol)}
                    data-testid={testId ? `${testId}-char-${char.name.toLowerCase().replace(/\s/g, '-')}` : undefined}
                  >
                    <span className="font-mono text-lg mr-2">{char.symbol}</span>
                    <span className="text-sm">{char.name}</span>
                  </DropdownMenuItem>
                ))}
              </DropdownMenuContent>
            </DropdownMenu>
            <div className="w-px h-6 bg-border mx-1" />
          </>
        )}
        <Button
          type="button"
          variant={rawMode ? "default" : "ghost"}
          size="sm"
          className="h-8 px-2"
          onClick={toggleRawMode}
          title={rawMode ? "Switch to Visual Editor" : "Switch to Raw HTML"}
          data-testid={testId ? `${testId}-raw-mode` : undefined}
        >
          <Code size={16} className="mr-1" />
          <span className="text-xs">{rawMode ? "Visual" : "HTML"}</span>
        </Button>
      </div>

      {/* Editor */}
      {rawMode ? (
        <Textarea
          value={rawHtml}
          onChange={handleRawHtmlChange}
          placeholder="Enter raw HTML here..."
          className="min-h-[120px] p-3 font-mono text-sm border-0 rounded-none focus-visible:ring-0 resize-none"
          rows={8}
          data-testid={testId ? `${testId}-raw` : undefined}
        />
      ) : (
        <div
          ref={editorRef}
          contentEditable
          className={cn(
            "min-h-[120px] p-3 outline-none prose prose-sm max-w-none",
            "focus:ring-2 focus:ring-ring focus:ring-offset-0",
            !value && !isFocused && "text-muted-foreground"
          )}
          onInput={handleInput}
          onFocus={() => setIsFocused(true)}
          onBlur={() => setIsFocused(false)}
          onKeyDown={handleKeyDown}
          data-placeholder={placeholder}
          data-testid={testId}
          suppressContentEditableWarning
        />
      )}

      <style>{`
        [contenteditable][data-placeholder]:empty:before {
          content: attr(data-placeholder);
          color: hsl(var(--muted-foreground));
          pointer-events: none;
          position: absolute;
        }
        [contenteditable] {
          word-wrap: break-word;
          overflow-wrap: break-word;
        }
        [contenteditable] strong,
        [contenteditable] b {
          font-weight: 600;
        }
        [contenteditable] em,
        [contenteditable] i {
          font-style: italic;
        }
        [contenteditable] ul,
        [contenteditable] ol {
          padding-left: 1.5rem;
          margin: 0.5rem 0;
        }
        [contenteditable] li {
          margin: 0.25rem 0;
        }
        [contenteditable] a {
          color: hsl(var(--primary));
          text-decoration: underline;
        }
        [contenteditable] a:hover {
          opacity: 0.8;
        }
      `}</style>
    </div>
  );
}

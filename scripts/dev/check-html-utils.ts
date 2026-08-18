#!/usr/bin/env tsx
/**
 * Check HTML Utility Consolidation
 *
 * HTML handling used to be reinvented per call site: six copies of an
 * escape helper (three of which escaped a different set of characters),
 * five mutually inconsistent sanitizers, and two partial entity
 * decoders. The visible cost was that "what may this content contain?"
 * had a different answer in every file, and nobody could see the set.
 *
 * `shared/utils/html/` is now the one library that owns escaping,
 * entity decoding, HTML→text conversion, and sanitization, with every
 * tag/attribute allowlist written down once in `policies.ts`.
 *
 * A consolidation only holds if re-fragmenting it is noisy, so this
 * check fails on the three ways it drifted apart before:
 *
 *   1. A locally defined escape helper (`function escapeHtml`, …).
 *   2. A raw HTML-entity `.replace()` chain — hand-rolled escaping or
 *      decoding, in either direction.
 *   3. A direct DOMPurify import, which is how a sixth allowlist gets
 *      written inline instead of being added to the policy table.
 *
 * Like scripts/dev/check-env-registry.ts, this scans the CURRENT working
 * tree — tracked AND untracked files — so a brand-new file cannot dodge
 * the check before its first commit.
 *
 * Run with:  npx tsx scripts/dev/check-html-utils.ts
 *
 * Exits 0 on pass, 1 on violations.
 */
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

/** The library that is allowed to do all three of these things. */
const HTML_LIBRARY_PREFIX = "shared/utils/html/";

/**
 * Narrow, documented exemptions. Add entries ONLY with a justification —
 * every exemption is another place a future reader has to look.
 */
const EXEMPT_FILES = new Set<string>([
  // This check script itself: needs the literal patterns to search for.
  "scripts/dev/check-html-utils.ts",
]);

const SCANNED_PREFIXES = ["client/", "server/", "shared/", "scripts/"];
const SCANNED_EXTENSIONS = [".ts", ".tsx", ".js", ".mjs", ".cjs"];

interface Rule {
  id: string;
  /** Matched against a single line of source. */
  test: (line: string) => boolean;
  /** What the author should do instead. */
  remedy: string;
}

/** Entity literals that betray hand-rolled escaping or decoding. */
const ENTITY_LITERAL =
  /&(?:amp|lt|gt|quot|apos|nbsp|copy|reg|trade|bull|ndash|mdash|hellip|#\d+|#x[0-9a-fA-F]+);/;

const RULES: Rule[] = [
  {
    id: "local-escape-helper",
    test: (line) =>
      /(?:function|const|let|var)\s+(?:escapeHtml|escapeHTML|htmlEscape|escapeHtmlAttr)\b/.test(
        line,
      ),
    remedy:
      "import { escapeHtml } from '@shared/utils/html' (or '.../html/escape' on the boot path)",
  },
  {
    id: "entity-replace-chain",
    test: (line) => line.includes(".replace(") && ENTITY_LITERAL.test(line),
    remedy:
      "use escapeHtml() to encode text, or decodeHtmlEntities() to decode it — both from @shared/utils/html",
  },
  {
    id: "direct-dompurify",
    test: (line) =>
      /\bfrom\s+["'](?:isomorphic-)?dompurify["']/.test(line) ||
      /\brequire\(\s*["'](?:isomorphic-)?dompurify["']\s*\)/.test(line) ||
      /\bimport\(\s*["'](?:isomorphic-)?dompurify["']\s*\)/.test(line),
    remedy:
      "call sanitizeHtml(html, '<policy>') from @shared/utils/html; add a policy to shared/utils/html/policies.ts if none fits",
  },
];

function listWorkingTreeFiles(): string[] {
  const tracked = execSync("git ls-files", { encoding: "utf8" });
  const untracked = execSync("git ls-files --others --exclude-standard", {
    encoding: "utf8",
  });
  return Array.from(
    new Set(
      (tracked + "\n" + untracked)
        .split("\n")
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  );
}

function isScanned(file: string): boolean {
  if (!SCANNED_PREFIXES.some((p) => file.startsWith(p))) return false;
  if (!SCANNED_EXTENSIONS.some((e) => file.endsWith(e))) return false;
  if (file.startsWith(HTML_LIBRARY_PREFIX)) return false;
  if (EXEMPT_FILES.has(file)) return false;
  return true;
}

interface Violation {
  rule: string;
  remedy: string;
  file: string;
  line: number;
  text: string;
}

export function findViolations(files: string[]): Violation[] {
  const violations: Violation[] = [];
  for (const file of files) {
    let content: string;
    try {
      content = readFileSync(file, "utf8");
    } catch {
      continue; // deleted-but-still-listed files
    }
    const lines = content.split("\n");
    for (let i = 0; i < lines.length; i++) {
      for (const rule of RULES) {
        if (rule.test(lines[i])) {
          violations.push({
            rule: rule.id,
            remedy: rule.remedy,
            file,
            line: i + 1,
            text: lines[i].trim(),
          });
        }
      }
    }
  }
  return violations;
}

function main(): void {
  const files = listWorkingTreeFiles().filter(isScanned);
  const violations = findViolations(files);

  if (violations.length === 0) {
    console.log(
      `[check-html-utils] OK — escaping, entity decoding and sanitization all live in ${HTML_LIBRARY_PREFIX} (${files.length} files scanned).`,
    );
    process.exit(0);
  }

  console.error(
    [
      "",
      "[check-html-utils] FAILED — HTML handling defined outside the shared library.",
      "",
      `All escaping, entity decoding and sanitization belongs in ${HTML_LIBRARY_PREFIX}.`,
      "Remember the distinction: escapeHtml() is for text that must NOT render as",
      "markup; sanitizeHtml(html, policy) is for markup that must. They are not",
      "interchangeable — see the header of shared/utils/html/index.ts.",
      "",
      "Violations:",
      ...violations.map(
        (v) => `  ${v.file}:${v.line}  [${v.rule}]  ${v.text}\n      → ${v.remedy}`,
      ),
      "",
      "Genuinely impossible cases may be added to EXEMPT_FILES in",
      "scripts/dev/check-html-utils.ts with a comment justifying the exemption.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

// Only run when executed directly (tests may import findViolations).
if (process.argv[1] && /check-html-utils\.ts$/.test(process.argv[1])) {
  main();
}

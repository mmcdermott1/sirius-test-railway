/**
 * Author-time check: the Template Studio is the ONLY place a tokenized
 * string is edited.
 *
 * A token is not a piece of text formatting — it is a promise that some
 * record will be reachable at delivery time, and the only place that
 * promise can be checked is the studio, which validates every chain
 * against the live registry and renders it against a real record. An
 * inline picker on some other page offers the same braces with none of
 * that: it cannot say whether `{{worker.employer.name}}` resolves for
 * this audience, and it cannot show what the recipient will read. Two
 * doors onto the same field means two different answers to "what does
 * this token do here", and the weaker door is the one authors reach for.
 *
 * So token tooling stays behind one door. Concretely, outside
 * `client/src/components/template-studio/`:
 *
 *   1. IMPORTS. The studio's internals — the browser, the slash-menu
 *      field, the record picker, the studio itself — may not be
 *      imported. Hosts use the entry points below, which always open the
 *      whole studio. A host that imports a picker on its own is building
 *      the second door.
 *
 *   2. `enableTokens`. The rich-text editor is general-purpose and lives
 *      in `components/ui`; its token mode is studio furniture. Passing
 *      the prop turns any page into a token editor without any of the
 *      validation or preview, so only the studio may pass it.
 *
 *   3. TOKEN CATALOG FETCHES. Fetching the catalog is what a surface
 *      does when it is about to offer tokens itself. Naming the endpoint
 *      to hand to the studio is fine; querying it is not.
 *
 * What is NOT restricted: rendering saved token text read-only
 * (`TokenText`), and coverage/validation reporting the SERVER computes.
 * Showing an author what they already saved is not editing it.
 *
 * Run: npx tsx scripts/dev/check-studio-only-tokens.ts
 */
import { readdirSync, readFileSync, statSync } from "fs";
import { join, relative, resolve } from "path";

const ROOT = resolve(import.meta.dirname, "../..");
const CLIENT_SRC = join(ROOT, "client/src");
const STUDIO_DIR = "client/src/components/template-studio";

/**
 * Studio internals. Importing one of these is how a page grows its own
 * token affordance; the studio's own files may import them freely.
 */
const TOOLING_MODULES = [
  `${STUDIO_DIR}/TemplateStudio`,
  `${STUDIO_DIR}/TokenTreeBrowser`,
  `${STUDIO_DIR}/SlashTokenField`,
  `${STUDIO_DIR}/PreviewRecordPicker`,
];

/**
 * The way in for everyone else: these open the whole studio (or render
 * saved text read-only), so they cannot become a second door.
 *
 *   TokenStudio / TokenStudioButton  — the generic popup
 *   NotifierTemplateStudio           — the notifier's own host
 *   TokenText                        — read-only summary rendering
 */

/** Endpoints that serve a token catalog or its browsable tree. */
const TOKEN_ENDPOINTS = ["/api/bulk-tokens", "/api/token-studio"];

/** A line that is doing the fetching, rather than naming the URL. */
const FETCHING = /\bqueryKey\b|\bfetch\s*\(|\bapiRequest\s*\(/;

/**
 * Files allowed to break a rule, each with the reason. Empty of pages
 * and meant to stay that way — an entry here is a surface where an
 * author can edit tokens without the studio's validation and preview.
 */
const EXEMPT: Record<string, string> = {
  // Declares the `enableTokens` prop and implements the mode; inert
  // unless a host passes it, and rule 2 restricts who may.
  "client/src/components/ui/simple-html-editor.tsx":
    "defines the enableTokens prop that this check restricts",
};

let failures = 0;
function fail(file: string, detail: string) {
  console.log(`FAIL: ${file}`);
  console.log(`  ${detail}`);
  failures++;
}

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      walk(full, out);
    } else if (/\.tsx?$/.test(entry)) {
      out.push(full);
    }
  }
  return out;
}

/** Resolve an import specifier to a repo-relative path, extension-free. */
function resolveSpecifier(spec: string, fromFile: string): string | null {
  let abs: string;
  if (spec.startsWith("@/")) {
    abs = join(CLIENT_SRC, spec.slice(2));
  } else if (spec.startsWith(".")) {
    abs = resolve(join(fromFile, ".."), spec);
  } else {
    return null;
  }
  return relative(ROOT, abs).replace(/\.tsx?$/, "");
}

function main() {
  const files = walk(CLIENT_SRC).sort();
  const seenExemptions = new Set<string>();
  let checked = 0;

  for (const full of files) {
    const rel = relative(ROOT, full);
    if (rel.startsWith(STUDIO_DIR)) continue;
    checked++;

    const source = readFileSync(full, "utf8");
    const exemptReason = EXEMPT[rel];
    if (exemptReason) seenExemptions.add(rel);

    // 1. Imports of studio internals.
    for (const m of source.matchAll(/from\s+["']([^"']+)["']/g)) {
      const target = resolveSpecifier(m[1], full);
      if (target && TOOLING_MODULES.includes(target)) {
        if (exemptReason) continue;
        fail(
          rel,
          `imports studio internals "${m[1]}" — token editing belongs in the ` +
            `Template Studio; open it with TokenStudio / TokenStudioButton, or ` +
            `render saved text read-only with TokenText`,
        );
      }
    }

    // 2. Turning on the rich editor's token mode.
    if (/\benableTokens\b/.test(source) && !exemptReason) {
      fail(
        rel,
        `passes enableTokens to the rich-text editor — that makes this surface a ` +
          `token editor with no chain validation and no preview; open the studio ` +
          `instead`,
      );
    }

    // 3. Fetching a token catalog. Hosts legitimately NAME the endpoint
    // to hand to the studio, so a URL held in a const is fine — until
    // that const shows up on a line that fetches.
    if (!exemptReason) {
      const bound = new Map<string, string>();
      for (const m of source.matchAll(
        /(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*["'`]([^"'`]+)["'`]/g,
      )) {
        const endpoint = TOKEN_ENDPOINTS.find((e) => m[2].startsWith(e));
        if (endpoint) bound.set(m[1], endpoint);
      }
      source.split("\n").forEach((line, i) => {
        if (!FETCHING.test(line)) return;
        const hit =
          TOKEN_ENDPOINTS.find((e) => line.includes(e)) ??
          [...bound].find(([name]) =>
            new RegExp(`\\b${name}\\b`).test(line),
          )?.[1];
        if (!hit) return;
        fail(
          `${rel}:${i + 1}`,
          `fetches the token catalog "${hit}" — a surface only needs the catalog ` +
            `to offer tokens itself; pass the URL to the studio (catalogUrl / ` +
            `treeBaseUrl) and let it do the fetching`,
        );
      });
    }
  }

  // A stale exemption is a rule that quietly stopped applying.
  for (const key of Object.keys(EXEMPT)) {
    if (!seenExemptions.has(key)) {
      fail(key, "exemption no longer matches any file — remove it");
    }
  }

  console.log(`\nChecked ${checked} client files outside ${STUDIO_DIR}/.`);
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

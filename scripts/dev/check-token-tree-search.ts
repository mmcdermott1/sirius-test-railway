/**
 * Author-time check: the browsable token tree's search must only ever
 * offer tokens the grammar accepts, and must not hide tokens the picker
 * can browse to.
 *
 * Two invariants, both cheap to break by tweaking a depth constant:
 *   1. Every search hit parses as a valid chain (which enforces
 *      MAX_CHAIN_DEPTH and the argument syntax) and carries no
 *      unfinished `name=""` stub.
 *   2. The deepest insertable token reachable by browsing is also
 *      findable by search — a search cap shorter than the grammar's
 *      would silently drop the deepest tokens.
 *
 * Run: npx tsx scripts/dev/check-token-tree-search.ts
 */
import "../../server/storage/database";
import { MAX_CHAIN_DEPTH, parseTokenChain, validateChain } from "@shared/tokens";
import { loadComponentCache } from "../../server/services/component-cache";
import "../../server/modules/components";

/** Roots a notifier surface seeds, plus the ordinary ones. */
const CONTEXT_ROOTS = ["dispatch", "dispatch_fore", "edls_sheet", "grievance_status", "event"];

const QUERIES = [
  "a",
  "e",
  "id",
  "name",
  "date",
  "field",
  "worker",
  "contact",
  "address",
  "dispatch",
  "employer",
  "status",
];

let failures = 0;
function fail(message: string) {
  console.error(`FAIL: ${message}`);
  failures++;
}

async function main() {
  await loadComponentCache();
  await import("../../server/plugins/tokens/index");
  await import("../../server/plugins/event-notifier/index");
  const { listTokenTreeRoots, expandTokenType, searchTokenTree } = await import(
    "../../server/plugins/tokens"
  );
  const { buildSegmentSpecsForRoots } = await import("../../server/plugins/tokens/evaluate");

  const roots = listTokenTreeRoots(CONTEXT_ROOTS);
  const rootNames = roots.map((r) => r.name);
  const specs = buildSegmentSpecsForRoots(rootNames);
  console.log(`tree roots: ${rootNames.join(", ")}`);

  // ── 1. every hit is a valid, complete token ─────────────────────────
  let checked = 0;
  for (const q of QUERIES) {
    for (const hit of searchTokenTree(CONTEXT_ROOTS, q, { limit: 500 })) {
      checked++;
      if (hit.expression.includes('name=""')) {
        fail(`search "${q}" offers an unfinished token: {{${hit.expression}}}`);
        continue;
      }
      const parsed = parseTokenChain(hit.expression);
      if (!parsed.ok) {
        fail(`search "${q}" offers an unparseable token {{${hit.expression}}}: ${parsed.error}`);
        continue;
      }
      if (parsed.segments.length > MAX_CHAIN_DEPTH) {
        fail(
          `search "${q}" offers a ${parsed.segments.length}-segment token (cap ${MAX_CHAIN_DEPTH}): {{${hit.expression}}}`,
        );
        continue;
      }
      const valid = validateChain(parsed.segments, specs);
      if (!valid.ok) {
        fail(`search "${q}" offers an invalid token {{${hit.expression}}}: ${valid.error}`);
      }
      if (hit.path.length === 0) fail(`hit {{${hit.expression}}} carries no path`);
    }
  }
  console.log(`  pass 1: ${checked} hit(s) across ${QUERIES.length} queries are valid tokens`);

  // ── 2. the deepest browsable token is findable ──────────────────────
  // Independent walk of the same tree, bounded by the grammar's cap.
  interface Walk {
    expression: string;
    type: string;
    depth: number;
    leafName?: string;
  }
  const queue: Walk[] = roots.map((r) => ({ expression: r.name, type: r.type, depth: 1 }));
  let deepest: Walk | undefined;
  let expanded = 0;
  const seenTypes = new Set<string>();
  while (queue.length > 0 && expanded < 2000) {
    const node = queue.shift()!;
    expanded++;
    if (node.depth >= MAX_CHAIN_DEPTH) continue;
    for (const child of expandTokenType(node.type).children) {
      if (child.needsArgument) continue;
      const expression = `${node.expression}${child.suffix}`;
      const depth = node.depth + 1;
      if (child.kind === "relation") {
        if (child.outputType && depth < MAX_CHAIN_DEPTH) {
          // One visit per (type, depth) keeps a cyclic graph finite.
          const key = `${child.outputType}@${depth}`;
          if (!seenTypes.has(key)) {
            seenTypes.add(key);
            queue.push({ expression, type: child.outputType, depth });
          }
        }
        continue;
      }
      if (!deepest || depth > deepest.depth) {
        deepest = { expression, type: "", depth, leafName: child.segment };
      }
    }
  }

  if (!deepest) {
    fail("browsing the tree found no insertable token at all");
  } else {
    console.log(
      `  deepest browsable token: {{${deepest.expression}}} (${deepest.depth} segment(s))`,
    );
    const term = deepest.leafName ?? "";
    const hits = searchTokenTree(CONTEXT_ROOTS, term, { limit: 5000 });
    if (!hits.some((h) => h.expression === deepest!.expression)) {
      fail(
        `search "${term}" cannot find the deepest browsable token {{${deepest.expression}}} — the search cap is shorter than the grammar's`,
      );
    } else {
      console.log(`  pass 2: search "${term}" finds it among ${hits.length} hit(s)`);
    }
  }

  if (failures > 0) {
    console.error(`\n${failures} failure(s).`);
    process.exit(1);
  }
  console.log("\n✓ Token tree search stays inside the grammar and reaches its full depth.");
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

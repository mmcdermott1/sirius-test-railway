#!/usr/bin/env tsx
/**
 * Check: every value-producing token ships sample data.
 *
 * In sample mode a leaf token renders
 * `sampleValue(args) ?? example ?? defaultValue ?? ""`. Nothing in the type
 * system forces a token to declare any of those, so a token whose author
 * forgot renders as an empty string — an invisible hole in the template
 * preview that an admin cannot tell apart from a genuinely blank value.
 * This check makes sample data a declared obligation:
 *
 *  1. Metadata pass — every registered token plugin with
 *     `outputType: "value"` must produce a non-empty sample string from its
 *     own declarations (`sampleValue` with argument defaults applied, else
 *     `example`, else `defaultValue`). Runs over the WHOLE registry, not
 *     just component-enabled plugins: sample coverage is a property of the
 *     plugin, not of which components a given deployment happens to run.
 *
 *  2. Catalog pass — walk the real picker catalog (root chains plus the
 *     `event`-rooted catalog for every entity kind) and render every entry
 *     in sample mode, so argument-dependent leaves and default-leaf
 *     desugaring are covered as the studio would render them. Entity
 *     entries carry a `field(name="")` template the author completes; those
 *     are expanded against the live field catalog and every field name is
 *     rendered.
 *
 * Plugin files are discovered from the plugins directory, so a new token
 * plugin is covered the moment it lands — that is the point of the check.
 *
 * Run: npx tsx scripts/dev/check-token-sample-data.ts (registered as the
 * `token-sample-data` validation).
 */
import { readdirSync } from "fs";
import { join } from "path";
import { pathToFileURL } from "url";
import type { TokenSegment } from "../../shared/tokens";

const PLUGINS_DIR = "server/plugins/tokens/plugins";
/**
 * Notifier plugins are loaded too: each declares the NAMED RECORD ROOTS
 * its templates address (`dispatch`, `sitespecific_t631_interview`, …),
 * and those roots — with the extra fields a notifier merges onto the
 * row — only exist once the notifier has registered.
 */
const NOTIFIER_PLUGINS_DIR = "server/plugins/event-notifier/plugins";

/** Storage stand-in: sample mode must never touch the database. */
const noStorage = new Proxy(
  {},
  {
    get(_t, prop) {
      throw new Error(
        `sample-mode rendering touched storage.${String(prop)} — sample values must be static metadata`,
      );
    },
  },
) as never;

const failures: string[] = [];
function fail(message: string) {
  failures.push(message);
}

/** Load every token plugin file (side-effect registration). */
async function loadPlugins(cwd: string): Promise<string[]> {
  // Boot-order guard: `_core/registry` sits in an import cycle with the
  // component-gating chain, so a standalone script that reaches it first
  // crashes with "Cannot access 'PluginRegistry' before initialization".
  // Importing the components module first orders the cycle the way the app
  // does. Registering the other plugin kinds along the way is chatty, so
  // silence the logger before it happens.
  const { logger } = await import("../../server/logger");
  for (const transport of logger.transports) transport.silent = true;
  await import("../../server/modules/components");

  const dir = join(cwd, PLUGINS_DIR);
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".ts") && !f.endsWith(".d.ts"))
    .sort();
  for (const f of files) {
    await import(pathToFileURL(join(dir, f)).href);
  }

  const notifierDir = join(cwd, NOTIFIER_PLUGINS_DIR);
  for (const f of readdirSync(notifierDir)
    .filter((n) => n.endsWith(".ts") && !n.endsWith(".d.ts"))
    .sort()) {
    await import(pathToFileURL(join(notifierDir, f)).href);
  }
  return files;
}

async function main() {
  const cwd = process.cwd();
  const files = await loadPlugins(cwd);

  const { tokenPluginRegistry, findSegmentPlugin } = await import(
    "../../server/plugins/tokens/registry"
  );
  // Sample coverage must not depend on the components this environment has
  // enabled (or on a database being reachable at all), so every registered
  // plugin counts as enabled for the duration of this check. Overridden on
  // the instance — nothing else in the token evaluator reads component state.
  Object.assign(tokenPluginRegistry, {
    listEnabledSync: () => tokenPluginRegistry.list(),
  });

  const { parseTokenChain } = await import("../../shared/tokens");
  const {
    buildFieldCatalog,
    buildTokenCatalog,
    buildTokenCatalogForRoots,
    createTokenEvalContext,
    evaluateChain,
  } = await import("../../server/plugins/tokens/evaluate");

  const plugins = tokenPluginRegistry.list();
  console.log(
    `check-token-sample-data: ${plugins.length} token plugin(s) from ${files.length} file(s)\n`,
  );

  // ── Pass 1: per-plugin declared sample data ────────────────────────────────
  const valuePlugins = plugins.filter((p) => p.metadata.outputType === "value");
  for (const p of valuePlugins) {
    const args: Record<string, string> = {};
    for (const [key, spec] of Object.entries(p.metadata.args ?? {})) {
      if (spec.default !== undefined) args[key] = spec.default;
    }
    let sample: string | undefined;
    try {
      sample = p.sampleValue?.(args);
    } catch (err) {
      fail(
        `${p.metadata.id}: sampleValue() threw with default arguments — ${
          err instanceof Error ? err.message : String(err)
        }`,
      );
      continue;
    }
    const declared = sample ?? p.metadata.example ?? p.metadata.defaultValue;
    if (declared === undefined || declared.trim() === "") {
      fail(
        `${p.metadata.id} ('${p.metadata.segmentName}') produces a value but declares no sample data — ` +
          `add a realistic, obviously-fake \`example\` (or a \`sampleValue(args)\` when the sample depends on arguments).`,
      );
    }
  }
  console.log(`  pass 1: ${valuePlugins.length} value-producing plugin(s) checked`);

  // ── Pass 2: render the picker catalog in sample mode ───────────────────────
  const fieldCatalog = buildFieldCatalog();

  // ── Pass 1b: named sample sets name real fields ────────────────────────────
  // A sample set keyed by a field name that does not exist renders
  // nothing — the persona silently half-applies and the author never
  // finds out. Every key must be either a field of the kind or the
  // segment name of a value leaf reading that kind.
  const { listSampleSetDeclarations } = await import(
    "../../server/plugins/tokens/sample-sets"
  );
  const { normalizeFieldName } = await import("../../shared/tokens");
  const declarations = listSampleSetDeclarations();
  const setLabels = new Map<string, { label: string; kind: string }>();
  let setKeysChecked = 0;
  for (const { kind, sets } of declarations) {
    const catalogEntry = fieldCatalog[kind];
    const names = new Set(
      (catalogEntry?.names ?? []).map((n: string) => normalizeFieldName(n)),
    );
    const leafNames = new Set(
      valuePlugins
        .filter(
          (p) =>
            p.metadata.inputTypes.includes(kind) || p.metadata.inputTypes.includes("*"),
        )
        .map((p) => normalizeFieldName(p.metadata.segmentName)),
    );
    for (const set of sets) {
      const seen = setLabels.get(set.id);
      if (seen && seen.label !== set.label) {
        fail(
          `sample set "${set.id}" is labelled "${set.label}" for kind "${kind}" but ` +
            `"${seen.label}" for kind "${seen.kind}" — one persona, one label.`,
        );
      } else if (!seen) {
        setLabels.set(set.id, { label: set.label, kind });
      }
      for (const [key, value] of Object.entries(set.values)) {
        setKeysChecked++;
        if (typeof value !== "string" || value.trim() === "") {
          fail(
            `sample set "${set.id}" for kind "${kind}" gives an empty value for "${key}" — ` +
              `omit the key instead, so the token's own example applies.`,
          );
        }
        const normalized = normalizeFieldName(key);
        if (names.has(normalized) || leafNames.has(normalized)) continue;
        if (catalogEntry?.open) continue;
        fail(
          `sample set "${set.id}" for kind "${kind}" names "${key}", which is neither a ` +
            `field of that kind nor a token leaf reading it — it would never render.`,
        );
      }
    }
  }
  console.log(
    `  pass 1b: ${setKeysChecked} sample-set value(s) across ${declarations.length} kind(s), ` +
      `${setLabels.size} persona(s)`,
  );

  /** The entity type a written chain ends at (mirrors the evaluator's walk). */
  function chainOutputType(segments: TokenSegment[]): string | null {
    let currentType = "root";
    for (const seg of segments) {
      const plugin = findSegmentPlugin(seg.name, currentType);
      if (!plugin) return null;
      currentType = plugin.metadata.outputType;
    }
    return currentType;
  }

  let rendered = 0;
  // One missing example shows up in every event-rooted catalog; report the
  // first occurrence of each expression so the failure list stays readable.
  const reportedExprs = new Set<string>();
  /**
   * The persona the current catalog walk renders with. Every declared
   * set is walked: a set that overrides a field with a blank (or that
   * makes a leaf throw) must fail here, not in front of an admin.
   */
  let sampleSetId: string | undefined;
  async function renderSample(expr: string, origin: string) {
    const parsed = parseTokenChain(expr);
    if (!parsed.ok) {
      fail(`${origin}: {{${expr}}} does not parse — ${parsed.error}`);
      return;
    }
    // No seeds at all: a seeded root would resolve for real (per-root
    // sample mode) and this check has no database. Context roots still
    // walk — an unseeded root is exactly what sample mode renders.
    const ctx = createTokenEvalContext(noStorage, undefined, {
      sample: true,
      sampleSetId,
    });
    const result = await evaluateChain(parsed.segments, ctx);
    rendered++;
    if (result.status === "invalid") {
      if (reportedExprs.has(`${sampleSetId ?? ""}:${expr}`)) return;
      reportedExprs.add(`${sampleSetId ?? ""}:${expr}`);
      fail(`${origin}: {{${expr}}} is invalid in sample mode — ${result.error}`);
      return;
    }
    const value = result.status === "ok" ? result.value : result.defaultValue;
    if (value.trim() === "") {
      if (reportedExprs.has(`${sampleSetId ?? ""}:${expr}`)) return;
      reportedExprs.add(`${sampleSetId ?? ""}:${expr}`);
      fail(
        `${origin}: {{${expr}}} renders empty in sample mode — the preview would show a silent gap. ` +
          `Declare an \`example\` on the leaf token.`,
      );
    }
  }

  /** Expand an entry, substituting real field names for `field(name="")`. */
  async function checkEntry(insertText: string, origin: string) {
    const expr = insertText.replace(/^\{\{/, "").replace(/\}\}$/, "");
    const placeholder = 'field(name="")';
    if (!expr.endsWith(placeholder)) {
      await renderSample(expr, origin);
      return;
    }
    const prefix = expr.slice(0, -placeholder.length - 1); // drop the trailing "."
    const parsedPrefix = parseTokenChain(prefix);
    if (!parsedPrefix.ok) {
      fail(`${origin}: {{${prefix}}} does not parse — ${parsedPrefix.error}`);
      return;
    }
    const type = chainOutputType(parsedPrefix.segments);
    const names = type ? (fieldCatalog[type]?.names ?? []) : [];
    if (names.length === 0) {
      // Open/unenumerable entity kinds: a name the author invents must
      // still render visibly.
      await renderSample(`${prefix}.field(name="some_field")`, origin);
      return;
    }
    for (const name of names) {
      await renderSample(`${prefix}.field(name="${name}")`, origin);
    }
  }

  // Named-record-root catalogs: one per registered context root (each
  // notifier's records, the event envelope), so notifier template
  // editors are covered the same way as the ordinary roots.
  const { listTokenContextRoots } = await import(
    "../../server/plugins/tokens/context-roots"
  );
  const contextRootNames = listTokenContextRoots()
    .map((root) => root.name)
    .sort();

  // Once with no persona (each token's own example), then once per
  // declared persona — the studio offers all of them, so all of them
  // have to render.
  const personas: Array<string | undefined> = [
    undefined,
    ...Array.from(setLabels.keys()).sort(),
  ];
  for (const persona of personas) {
    sampleSetId = persona;
    const suffix = persona ? `[sample=${persona}]` : "";
    for (const entry of buildTokenCatalog()) {
      await checkEntry(entry.insertText, `catalog${suffix}`);
    }
    for (const name of contextRootNames) {
      for (const entry of buildTokenCatalogForRoots([name])) {
        await checkEntry(entry.insertText, `catalog${suffix}[root=${name}]`);
      }
    }
  }
  sampleSetId = undefined;
  console.log(
    `  pass 2: ${rendered} sample render(s) across the catalog, ` +
      `${contextRootNames.length} named record root(s) ` +
      `and ${personas.length} persona setting(s)\n`,
  );

  if (failures.length === 0) {
    console.log("✓ Every value-producing token ships sample data.");
    process.exit(0);
  }
  console.log(`✗ ${failures.length} token sample-data failure(s):\n`);
  for (const f of failures) console.log(`  - ${f}`);
  console.log(
    "\nRULE: a token that produces a value must render something recognizable in",
  );
  console.log(
    "sample mode. Declare `example` (static, obviously fake) on the plugin, or",
  );
  console.log(
    "`sampleValue(args)` when the sample depends on the token's arguments.",
  );
  process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});

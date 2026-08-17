#!/usr/bin/env tsx
/**
 * Check Template Surfaces
 *
 * Every tokenized field previews through ONE route
 * (POST /api/template-studio/preview), which shapes each rendered
 * field according to the media type its surface declares — plain text,
 * trusted HTML (escape then sanitize), or safe-relative URL.
 *
 * A field with no declared media has no defined shaping, which means
 * its preview and its delivered output can silently disagree. This
 * check asserts, at author time, that every registered surface declares
 * a media type for every field it can render (plus the structural rules
 * registration enforces at boot: at least one field, unique keys, known
 * media, and `blankWithout` pointing at a real field).
 *
 * Run with:  npx tsx scripts/dev/check-template-surfaces.ts
 */
// Importing the index runs the side-effect surface registrations.
import {
  templateSurfaceRegistry,
  validateSurfaceFields,
} from "../../server/plugins/template-surfaces";

function main() {
  const surfaces = templateSurfaceRegistry.list();
  const failures: string[] = [];

  if (surfaces.length === 0) {
    failures.push("No template surfaces are registered at all");
  }

  for (const surface of surfaces) {
    for (const problem of validateSurfaceFields(surface)) {
      failures.push(`Surface '${surface.id}': ${problem}`);
    }
    const fieldSummary = surface.fields
      .map((f) => `${f.key}:${f.media}`)
      .join(", ");
    console.log(`  ${surface.id} — ${fieldSummary}`);
  }

  console.log("");
  if (failures.length === 0) {
    console.log(
      `PASS: ${surfaces.length} template surface(s), every field declares a media type`,
    );
    process.exit(0);
  }

  console.error(`FAIL: ${failures.length} problem(s)`);
  for (const failure of failures) console.error(`  - ${failure}`);
  process.exit(1);
}

main();

import { PluginRegistry } from "../_core";
import type { TemplateSurface, TemplateSurfaceFieldSpec } from "./types";

interface TemplateSurfaceEntry {
  id: string;
  name: string;
  description: string;
  fields: Array<{ key: string; media: string }>;
}

/**
 * Registry of template surfaces. Follows the shared plugin-registry
 * conventions: one registration per id (a duplicate throws at boot),
 * lookup by id, listing for author-time checks.
 *
 * Surfaces are never component- or policy-gated: they exist only to
 * describe delivery shaping, so the base registry's gating helpers are
 * unused here (every surface's metadata is bare).
 */
export const templateSurfaceRegistry = new PluginRegistry<
  TemplateSurface,
  TemplateSurfaceEntry
>({
  kind: "template-surface",
  getMetadata: (s) => ({
    id: s.id,
    name: s.name,
    description: s.description ?? "",
  }),
  toManifestEntry: (s) => ({
    id: s.id,
    name: s.name,
    description: s.description ?? "",
    fields: s.fields.map((f) => ({ key: f.key, media: f.media })),
  }),
});

/**
 * Structural problems with a surface's field declarations. Shared by
 * registration (fails at boot) and the author-time check script (fails
 * in CI, before a broken surface can ship).
 */
export function validateSurfaceFields(surface: TemplateSurface): string[] {
  const problems: string[] = [];
  const media = new Set(["text", "html", "relative-url", "literal"]);
  if (!Array.isArray(surface.fields) || surface.fields.length === 0) {
    problems.push("declares no fields");
    return problems;
  }
  const seen = new Set<string>();
  for (const field of surface.fields) {
    if (!field.key) {
      problems.push("has a field with no key");
      continue;
    }
    if (seen.has(field.key)) {
      problems.push(`declares field '${field.key}' more than once`);
    }
    seen.add(field.key);
    if (!field.media) {
      problems.push(`field '${field.key}' declares no media type`);
    } else if (!media.has(field.media)) {
      problems.push(`field '${field.key}' declares unknown media '${field.media}'`);
    }
  }
  for (const field of surface.fields) {
    if (field.blankWithout && !seen.has(field.blankWithout)) {
      problems.push(
        `field '${field.key}' depends on '${field.blankWithout}', which is not a declared field`,
      );
    }
  }
  return problems;
}

/**
 * Flatten a per-channel field table into the surface's field list.
 *
 * A key shared by two channels (a bulk SMS body and an in-app body) is
 * one field, so it is declared once — but only if both channels shape
 * it identically. Differing shapings would make the surface's single
 * declaration a lie for one of the channels.
 */
export function mergeChannelFieldSpecs(
  channels: Record<string, TemplateSurfaceFieldSpec[]>,
): TemplateSurfaceFieldSpec[] {
  const byKey = new Map<string, TemplateSurfaceFieldSpec>();
  for (const [channel, specs] of Object.entries(channels)) {
    for (const spec of specs) {
      const existing = byKey.get(spec.key);
      if (!existing) {
        byKey.set(spec.key, spec);
        continue;
      }
      if (JSON.stringify(existing) !== JSON.stringify(spec)) {
        throw new Error(
          `Field '${spec.key}' is shaped differently in channel '${channel}' than in another channel`,
        );
      }
    }
  }
  return [...byKey.values()];
}

/**
 * Register a template surface. Every field must declare a media type —
 * an undeclared field would preview differently from how it is
 * delivered, which is the one thing this registry exists to prevent.
 */
export function registerTemplateSurface(surface: TemplateSurface): void {
  const problems = validateSurfaceFields(surface);
  if (problems.length > 0) {
    throw new Error(
      `Template surface "${surface.id}" is invalid: ${problems.join("; ")}`,
    );
  }
  templateSurfaceRegistry.register(surface);
}

export function getTemplateSurface(id: string): TemplateSurface | undefined {
  return templateSurfaceRegistry.get(id);
}

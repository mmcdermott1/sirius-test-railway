import { registerTokenPlugin } from "../registry";
import { tokenEntityOf } from "../types";
import { formatPhpDate, fmtDateShort } from "../php-date";

function nowOf(entity: unknown, fallback: Date): Date {
  const e = tokenEntityOf(entity, "system");
  return e?.row.now instanceof Date ? e.row.now : fallback;
}

/**
 * The one date every system-date sample renders. Sample data is static
 * metadata by design (never randomized — two previews of the same
 * template must agree), pinned to the current year so it stays
 * consistent with what {{system.year}} samples as.
 */
const SAMPLE_DATE = new Date(new Date().getFullYear(), 3, 17, 9, 30);

/** Root: {{system...}} — server-side values independent of the recipient. */
registerTokenPlugin({
  metadata: {
    id: "token.system",
    name: "System",
    description: "System values (dates, year) independent of the recipient",
    segmentName: "system",
    inputTypes: ["root"],
    outputType: "system",
    // Nothing to pick for this root — it follows the render (see
    // `seedless`), so a preview with any real record shows real system
    // values and an all-sample preview shows sample ones.
    seedless: true,
  },
  async resolve(_entity, _args, ctx) {
    return { kind: "system", row: { now: ctx.now } };
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.year",
    name: "Current year",
    shortLabel: "current year",
    description: "Four-digit current year",
    segmentName: "year",
    inputTypes: ["system"],
    outputType: "value",
    defaultValue: String(new Date().getFullYear()),
    example: String(new Date().getFullYear()),
  },
  async resolve(entity, _args, ctx) {
    return String(nowOf(entity, ctx.now).getFullYear());
  },
});

/**
 * {{system.base_url}} — the absolute origin (https://…) for links that
 * leave the app. Always returns the deployment's absolute site origin,
 * regardless of delivery medium. In-app notifier templates that need
 * relative paths should use a plain relative path in their linkUrl
 * slot instead of this token.
 */
registerTokenPlugin({
  metadata: {
    id: "token.leaf.baseUrl",
    name: "Base URL",
    shortLabel: "base URL",
    description: "Absolute site origin for use in links",
    segmentName: "base_url",
    inputTypes: ["system"],
    outputType: "value",
    defaultValue: "",
    example: "https://example.com",
  },
  async resolve(_entity, _args, _ctx) {
    const { absoluteBaseUrl } = await import("../../../lib/base-url");
    return absoluteBaseUrl();
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.dateToday",
    name: "Today's date",
    shortLabel: "today's date",
    description: "Today's date, e.g. Apr 17, 2026",
    segmentName: "dateToday",
    inputTypes: ["system"],
    outputType: "value",
    example: fmtDateShort(SAMPLE_DATE),
  },
  async resolve(entity, _args, ctx) {
    return fmtDateShort(nowOf(entity, ctx.now));
  },
});

registerTokenPlugin({
  metadata: {
    id: "token.leaf.date",
    name: "Formatted date",
    shortLabel: "date (custom format)",
    description:
      'Today\'s date with a custom PHP-style format, e.g. date(format="Y-m-d")',
    segmentName: "date",
    inputTypes: ["system"],
    outputType: "value",
    args: {
      format: {
        default: "l, F j, Y",
        description: "PHP-style date format string",
      },
    },
    example: formatPhpDate(SAMPLE_DATE, "l, F j, Y"),
  },
  async resolve(entity, args, ctx) {
    return formatPhpDate(nowOf(entity, ctx.now), args.format ?? "l, F j, Y");
  },
  // Argument-dependent sample: a fixed `example` would contradict the
  // format the author actually asked for (a Y-m-d token previewing as
  // "Friday, April 17, 2026" is worse than no preview at all).
  sampleValue(args) {
    return formatPhpDate(SAMPLE_DATE, args.format ?? "l, F j, Y");
  },
});

import { registerTokenPlugin } from "../registry";
import { tokenEntityOf } from "../types";
import { formatPhpDate, fmtDateShort } from "../php-date";

function nowOf(entity: unknown, fallback: Date): Date {
  const e = tokenEntityOf(entity, "system");
  return e?.row.now instanceof Date ? e.row.now : fallback;
}

/** Root: {{system...}} — server-side values independent of the recipient. */
registerTokenPlugin({
  metadata: {
    id: "token.system",
    name: "System",
    description: "System values (dates, year) independent of the recipient",
    segmentName: "system",
    inputTypes: ["root"],
    outputType: "system",
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
 * leave the app. Audience-aware: email and SMS render the deployment's
 * absolute origin; in-app renders an empty string so templated links
 * like `{{system.base_url}}/workers/…` stay relative (in-app messages
 * navigate in place). A context without an audience renders empty too
 * (fail closed — never leak an absolute origin to an unknown surface).
 */
registerTokenPlugin({
  metadata: {
    id: "token.leaf.baseUrl",
    name: "Base URL",
    shortLabel: "base URL",
    description:
      "Absolute site origin for email/SMS links; empty for in-app (links stay relative)",
    segmentName: "base_url",
    inputTypes: ["system"],
    outputType: "value",
    defaultValue: "",
    example: "https://example.com",
  },
  async resolve(_entity, _args, ctx) {
    if (ctx.audience !== "email" && ctx.audience !== "sms") return "";
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
    example: "Apr 17, 2026",
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
    example: "Friday, April 17, 2026",
  },
  async resolve(entity, args, ctx) {
    return formatPhpDate(nowOf(entity, ctx.now), args.format ?? "l, F j, Y");
  },
});

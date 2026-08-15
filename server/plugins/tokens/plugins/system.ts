import { registerTokenPlugin } from "../registry";
import type { SystemEntity } from "../types";
import { formatPhpDate, fmtDateShort } from "../php-date";

function nowOf(entity: unknown, fallback: Date): Date {
  const e = entity as SystemEntity | null;
  return e?.kind === "system" ? e.now : fallback;
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
    const entity: SystemEntity = { kind: "system", now: ctx.now };
    return entity;
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

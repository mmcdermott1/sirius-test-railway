import { getTableColumns } from "drizzle-orm";
import { getTableConfig, type AnyPgTable, type PgColumn } from "drizzle-orm/pg-core";
import { normalizeFieldName } from "@shared/tokens";
import { registerTokenPlugin } from "../registry";
import { memo, type TokenEntity, type TokenEvalContext } from "../types";
import { formatPhpDate, fmtDateShort } from "../php-date";

/**
 * Find the row key matching a requested field name. Accepts either the
 * TS property name (camelCase) or the DB column name (snake_case);
 * comparison is case/underscore-insensitive.
 */
function resolveRowKey(entity: TokenEntity, name: string): string | null {
  const wanted = normalizeFieldName(name);
  // Direct row keys (covers derived/denorm extras and shaped entities).
  for (const key of Object.keys(entity.row)) {
    if (normalizeFieldName(key) === wanted) return key;
  }
  // DB column names → TS property names via the declared table.
  if (entity.table) {
    for (const [prop, col] of Object.entries(getTableColumns(entity.table))) {
      if (normalizeFieldName((col as PgColumn).name) === wanted) return prop;
    }
  }
  return null;
}

function columnFor(entity: TokenEntity, rowKey: string): PgColumn | undefined {
  if (!entity.table) return undefined;
  const cols = getTableColumns(entity.table) as Record<string, PgColumn>;
  return cols[rowKey];
}

/**
 * When the column is a foreign key to a table with a `name` column
 * (options tables, bargaining units, employers, …), render the
 * referenced row's display name instead of the raw id.
 */
async function followForeignKeyName(
  entity: TokenEntity,
  column: PgColumn,
  value: string,
  ctx: TokenEvalContext,
): Promise<string | null> {
  if (!entity.table) return null;
  const config = getTableConfig(entity.table);
  for (const fk of config.foreignKeys) {
    const ref = fk.reference();
    if (ref.columns.length !== 1 || ref.columns[0].name !== column.name) continue;
    const target = ref.foreignColumns[0].table as AnyPgTable;
    const targetCols = getTableColumns(target) as Record<string, PgColumn>;
    if (!targetCols.name) return null;
    const targetConfig = getTableConfig(target);
    const targetKeyCol = ref.foreignColumns[0].name;
    return memo(ctx, `fk-name:${targetConfig.name}:${value}`, () =>
      ctx.storage.bulkTokens.getNameByReference(
        targetConfig.name,
        targetKeyCol,
        value,
      ),
    );
  }
  return null;
}

function isDateColumn(column: PgColumn | undefined): boolean {
  if (!column) return false;
  const t = column.columnType || "";
  return t.includes("Date") || t.includes("Timestamp");
}

function formatValue(
  value: unknown,
  column: PgColumn | undefined,
  format: string | undefined,
): string | null {
  if (value == null || value === "") return null;
  if (value instanceof Date || isDateColumn(column)) {
    const d = value instanceof Date ? value : new Date(String(value));
    if (Number.isNaN(d.getTime())) return String(value);
    return format ? formatPhpDate(d, format) : fmtDateShort(d);
  }
  if (Array.isArray(value)) {
    const parts = value
      .map((v) => (v == null ? "" : String(v)))
      .filter((v) => v !== "");
    return parts.length > 0 ? parts.join(", ") : null;
  }
  if (typeof value === "object") return null; // jsonb blobs are not renderable
  if (typeof value === "boolean") return value ? "Yes" : "No";
  return String(value);
}

/**
 * Generic leaf: {{…entity.field(name="…")}} — reads any field off the
 * current entity. Works on every entity type; valid names derive from
 * the entity's declared table (see entityTable) plus derived extras.
 * Foreign keys to named tables render the referenced display name;
 * dates format with fmtDateShort or an explicit PHP-style format.
 */
registerTokenPlugin({
  metadata: {
    id: "token.field",
    name: "Field",
    shortLabel: "field",
    description: "A named field of the current entity",
    segmentName: "field",
    inputTypes: ["*"],
    outputType: "value",
    args: {
      name: {
        required: true,
        description: "Field name as defined in the schema (snake_case or camelCase)",
      },
      format: {
        description: "PHP-style date format for date fields (e.g. Y-m-d)",
      },
      default: {
        description: "Fallback text when the field is empty",
      },
    },
  },
  async resolve(entity, args, ctx) {
    const e = entity as TokenEntity | null;
    if (!e || typeof e !== "object" || !e.row) return null;
    const fallback = args.default || null;
    const key = resolveRowKey(e, args.name);
    if (!key) return fallback;
    const value = e.row[key];
    if (value == null || value === "") return fallback;
    const column = columnFor(e, key);
    if (column && typeof value === "string") {
      const refName = await followForeignKeyName(e, column, value, ctx);
      if (refName) return refName;
    }
    return formatValue(value, column, args.format) ?? fallback;
  },
  sampleValue(args) {
    return args.default || `\u00AB${args.name || "field"}\u00BB`;
  },
});

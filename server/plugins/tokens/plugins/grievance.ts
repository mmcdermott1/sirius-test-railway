import {
  grievances,
  grievanceStatusHistory,
} from "../../../../shared/schema/grievance/schema";
import { grievanceSettlements } from "../../../../shared/schema/grievance/settlement-schema";
import { registerTokenPlugin } from "../registry";
import {
  memo,
  tokenEntityOf,
  type TokenEntity,
  type TokenEvalContext,
} from "../types";

/**
 * Token plugins for the grievance entity kinds, used by the
 * token-templated grievance notifiers:
 *   - `grievance` — a grievance row (loaded with its denorm `name`).
 *   - `grievance_status_history` — one status-history entry; its
 *     `status_id` FK auto-renders the status option's name.
 *   - `grievance_settlement` — one settlement row; the notifier merges
 *     the event's `operation` (created/updated/deleted) onto the row.
 * All broadly reusable: any surface that renders with one of these
 * entity kinds gets the full field catalog for free.
 */
export const GRIEVANCE_ENTITY_KIND = "grievance";
export const GRIEVANCE_STATUS_HISTORY_ENTITY_KIND = "grievance_status_history";
export const GRIEVANCE_SETTLEMENT_ENTITY_KIND = "grievance_settlement";

const COMPONENT = "grievance";

/**
 * The grievance's display title, mirroring the client's `grievanceTitle`
 * (and the pre-token notifier wording): denorm name, else
 * "<Category> Grievance", else "Grievance <id-prefix>".
 */
export function composeGrievanceDisplayTitle(
  grievanceId: string,
  info: { name: string | null; categoryName: string | null } | undefined,
): string {
  if (info?.name && info.name.trim()) return info.name;
  if (info?.categoryName) return `${info.categoryName} Grievance`;
  return `Grievance ${grievanceId.slice(0, 8)}`;
}

/**
 * Build a grievance row (with its denorm display name) as a token entity,
 * straight off storage. Separate from {@link loadGrievanceEntity} so a surface
 * that seeds the grievance as a ROOT — an event notifier, which has no token
 * eval context when it builds its records — reaches the same shape.
 *
 * The row carries every column of `grievances` plus the two derived extras the
 * descriptor advertises (`name` from the denorm read, `display_title` here), so
 * every field the editor offers on this kind actually resolves.
 */
export async function buildGrievanceEntity(
  storage: TokenEvalContext["storage"],
  grievanceId: string,
): Promise<TokenEntity | null> {
  const [base, info] = await Promise.all([
    storage.grievances.get(grievanceId),
    storage.grievances.getAssignmentTitleInfo(grievanceId),
  ]);
  if (!base) return null;
  return composeGrievanceEntity(base, info);
}

/**
 * The same shape from a grievance row already in hand — a surface that
 * captured the grievance when its event fired renders that snapshot instead
 * of re-reading a row that may since have been renamed or deleted.
 */
export function composeGrievanceEntity(
  row: { id: string },
  info: { name: string | null; categoryName: string | null } | undefined,
): TokenEntity {
  const base = row as unknown as Record<string, unknown>;
  return {
    kind: GRIEVANCE_ENTITY_KIND,
    row: {
      ...base,
      // `name` is denormalised, not a column: a caller holding a raw
      // `grievances` row has the title parts but not the name itself.
      name: info?.name ?? base.name ?? null,
      displayTitle: composeGrievanceDisplayTitle(row.id, info),
    },
    table: grievances,
  };
}

/**
 * Load a grievance row (with its denorm display name) as a token entity.
 * `display_title` is a derived extra carrying the client's full title
 * fallback chain so templates never render a blank/generic title.
 */
export async function loadGrievanceEntity(
  ctx: TokenEvalContext,
  grievanceId: string,
): Promise<TokenEntity | null> {
  return memo(ctx, `grievance-entity:${grievanceId}`, () =>
    buildGrievanceEntity(ctx.storage, grievanceId),
  );
}

/**
 * Named sample grievances, one per shared persona id. Values are obviously
 * fictional: a preview must never be mistaken for a real member's grievance.
 */
const GRIEVANCE_SAMPLE_SETS = [
  {
    id: "martian",
    label: "Martian",
    values: {
      // `id` is named so the default templates' record links differ per
      // persona instead of all rendering the same placeholder.
      id: "SAMPLE-GRIEVANCE-001",
      sirius_id: "SAMPLE-G001",
      name: "Mars Colony Safety Violation",
      display_title: "Mars Colony Safety Violation",
      class_description: "Violation of Article 12, Section 4 — Safe Working Conditions",
      cardinality: "individual",
    },
  },
  {
    id: "historical",
    label: "Historical",
    values: {
      id: "SAMPLE-GRIEVANCE-002",
      sirius_id: "SAMPLE-G002",
      name: "Analytical Engine Working Hours",
      display_title: "Analytical Engine Working Hours",
      class_description: "Violation of Article 8, Section 2 — Hours of Work",
      cardinality: "individual",
    },
  },
  {
    id: "mythological",
    label: "Mythological",
    values: {
      id: "SAMPLE-GRIEVANCE-003",
      sirius_id: "SAMPLE-G003",
      name: "Navigation Duty Assignment",
      display_title: "Navigation Duty Assignment",
      class_description: "Violation of Article 15, Section 1 — Fair Work Assignment",
      cardinality: "group",
    },
  },
];

/**
 * Sample status entries. Keyed by the entry's OWN columns only — the
 * grievance's title is not one of them: a template reaches it through the
 * entry's `grievance` relation (or the notifier's own `grievance` root),
 * which renders from the grievance persona of the same name.
 *
 * `status_id` is the status FK, which renders as the status option's name.
 */
const GRIEVANCE_STATUS_HISTORY_SAMPLE_SETS = [
  {
    id: "martian",
    label: "Martian",
    values: {
      id: "SAMPLE-GRIEVANCE-STATUS-001",
      status_id: "Filed",
      date: "2031-03-04",
      is_current: "Yes",
    },
  },
  {
    id: "historical",
    label: "Historical",
    values: {
      id: "SAMPLE-GRIEVANCE-STATUS-002",
      status_id: "Arbitration",
      date: "1843-11-20",
      is_current: "Yes",
    },
  },
  {
    id: "mythological",
    label: "Mythological",
    values: {
      id: "SAMPLE-GRIEVANCE-STATUS-003",
      status_id: "Withdrawn",
      date: "1200-06-15",
      is_current: "Yes",
    },
  },
];

const GRIEVANCE_SETTLEMENT_SAMPLE_SETS = [
  {
    id: "martian",
    label: "Martian",
    values: {
      operation: "created",
      description: "Retroactive pay and new safety protocols for Sector 7 haulers",
      amount: "4500.00",
      summary: "Settlement reached: back pay plus safety equipment upgrade",
    },
  },
  {
    id: "historical",
    label: "Historical",
    values: {
      operation: "updated",
      description: "Revised access schedule and back pay for engine room operators",
      amount: "1200.00",
      summary: "Settlement amended: shortened shifts and schedule compensation",
    },
  },
  {
    id: "mythological",
    label: "Mythological",
    values: {
      operation: "deleted",
      description: "Navigation provisions dispute withdrawn after voyage reassignment",
      amount: "750.00",
      summary: "Settlement voided: grievant accepted alternate posting",
    },
  },
];

      async search(storage, query, limit) {
        const rows = await storage.grievanceSettlements.searchForPreview(
          query,
          limit,
        );
        return rows.map((row) => ({
          id: row.id,
          label: composeGrievanceDisplayTitle(row.grievanceId, {
            name: row.grievanceName,
            categoryName: row.grievanceCategoryName,
          }),
          hint: row.description ?? undefined,
        }));
      },

      async search(storage, query, limit) {
        const rows = await storage.grievanceSettlements.searchForPreview(
          query,
          limit,
        );
        return rows.map((row) => ({
          id: row.id,
          label: composeGrievanceDisplayTitle(row.grievanceId, {
            name: row.grievanceName,
            categoryName: row.grievanceCategoryName,
          }),
          hint: row.description ?? undefined,
        }));
      },

      async search(storage, query, limit) {
        const rows = await storage.grievanceSettlements.searchForPreview(
          query,
          limit,
        );
        return rows.map((row) => ({
          id: row.id,
          label: composeGrievanceDisplayTitle(row.grievanceId, {
            name: row.grievanceName,
            categoryName: row.grievanceCategoryName,
          }),
          hint: row.description ?? undefined,
        }));
      },
  async resolve() {
    return null;
  },
});

/** {{event.grievance.field(name="…")}} — the entry's/settlement's grievance. */
registerTokenPlugin({
  metadata: {
    id: "token.grievance_relation.grievance",
    name: "Grievance",
    description: "The grievance this record belongs to",
    segmentName: "grievance",
    inputTypes: [
      GRIEVANCE_STATUS_HISTORY_ENTITY_KIND,
      GRIEVANCE_SETTLEMENT_ENTITY_KIND,
    ],
    outputType: GRIEVANCE_ENTITY_KIND,
    entityTable: grievances,
    entityFields: ["name", "display_title"],
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
  },
  async resolve() {
    return null;
  },
});

/** {{event.grievance.field(name="…")}} — the entry's/settlement's grievance. */
registerTokenPlugin({
  metadata: {
    id: "token.grievance_relation.grievance",
    name: "Grievance",
    description: "The grievance this record belongs to",
    segmentName: "grievance",
    inputTypes: [
      GRIEVANCE_STATUS_HISTORY_ENTITY_KIND,
      GRIEVANCE_SETTLEMENT_ENTITY_KIND,
    ],
    outputType: GRIEVANCE_ENTITY_KIND,
    entityTable: grievances,
    entityFields: ["name", "display_title"],
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
  },
  async resolve() {
    return null;
  },
});

/** {{event.grievance.field(name="…")}} — the entry's/settlement's grievance. */
registerTokenPlugin({
  metadata: {
    id: "token.grievance_relation.grievance",
    name: "Grievance",
    description: "The grievance this record belongs to",
    segmentName: "grievance",
    inputTypes: [
      GRIEVANCE_STATUS_HISTORY_ENTITY_KIND,
      GRIEVANCE_SETTLEMENT_ENTITY_KIND,
    ],
    outputType: GRIEVANCE_ENTITY_KIND,
    entityTable: grievances,
    entityFields: ["name", "display_title"],
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
  },
  async resolve() {
    return null;
  },
});

      async load(storage, id) {
        const [{ settlementSummary }, row] = await Promise.all([
          import("../../event-notifier/plugins/grievance-settlement-notifier"),
          storage.grievanceSettlements.getById(id),
        ]);
        if (!row) return null;
        const info = await storage.grievances.getAssignmentTitleInfo(
          row.grievanceId,
        );
        const grievanceTitle = composeGrievanceDisplayTitle(
          row.grievanceId,
          info,
        );
        return {
          entity: {
            kind: GRIEVANCE_SETTLEMENT_ENTITY_KIND,
            row: {
              ...(row as unknown as Record<string, unknown>),
              operation: "created",
              // The title appears in the LABEL (so an author can tell the
              // entries apart) and inside the legacy summary sentence, but
              // never as a field of the settlement itself.
              summary: settlementSummary("created", grievanceTitle, row.amount),
            },
            table: grievanceSettlements,
          },
          label: grievanceTitle,
        };
      },

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
  return {
    kind: GRIEVANCE_ENTITY_KIND,
    row: {
      ...(base as unknown as Record<string, unknown>),
      displayTitle: composeGrievanceDisplayTitle(grievanceId, info),
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
      grievance_title: "Mars Colony Safety Violation",
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
      grievance_title: "Analytical Engine Working Hours",
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
      grievance_title: "Navigation Duty Assignment",
      summary: "Settlement voided: grievant accepted alternate posting",
    },
  },
];

/**
 * Grievance descriptor: never matches as a segment (`inputTypes: []`) —
 * exists so the field catalog derives valid `field(name=…)` names from
 * the live schema. `name` is the denorm display name the storage read
 * attaches to the row (not a table column).
 */
registerTokenPlugin({
  metadata: {
    id: "token.grievance",
    name: "Grievance",
    description: "Descriptor for the grievance entity kind",
    segmentName: "__grievance",
    inputTypes: [],
    outputType: GRIEVANCE_ENTITY_KIND,
    entityTable: grievances,
    entityFields: ["name", "display_title"],
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
    sampleSets: GRIEVANCE_SAMPLE_SETS,
    // A few real grievances a surface may OFFER as preview subjects
    // (there is no search and no load-by-id — a template author is not
    // entitled to name an arbitrary record). Gated on the grievance
    // component (inherited from the plugin): its tables need not exist
    // at all when the component is off.
    recentRecords: {
      async recent(limit) {
        const { storage } = await import("../../../storage");
        const rows = await storage.grievances.search();
        const picked = rows.slice(0, limit);
        const out = [];
        for (const g of picked) {
          const [base, info] = await Promise.all([
            storage.grievances.get(g.id),
            storage.grievances.getAssignmentTitleInfo(g.id),
          ]);
          if (!base) continue;
          const entity = {
            kind: GRIEVANCE_ENTITY_KIND,
            row: {
              ...(base as unknown as Record<string, unknown>),
              displayTitle: composeGrievanceDisplayTitle(g.id, info),
            },
            table: grievances,
          };
          out.push({
            id: g.id,
            label: [
              composeGrievanceDisplayTitle(g.id, {
                name: null,
                categoryName: g.categoryName,
              }),
              g.grievantSummary || null,
              g.statusName || null,
            ]
              .filter(Boolean)
              .join(" — "),
            entity,
          });
        }
        return out;
      },
    },
  },
  async resolve() {
    return null;
  },
});

/**
 * Status-history entry descriptor. The kind offers its OWN columns and
 * nothing else: `status_id` renders the status option's name through the
 * FK, and the grievance's title is reached through the `grievance`
 * relation below. There are deliberately no flattened extras — an extra
 * named after a related record's value ("grievance_title") reads like a
 * column of this table, and only resolves when whoever seeded the record
 * remembered to merge it.
 */
registerTokenPlugin({
  metadata: {
    id: "token.grievance_status_history",
    name: "Grievance status entry",
    description: "Descriptor for the grievance status-history entity kind",
    segmentName: "__grievance_status_history",
    inputTypes: [],
    outputType: GRIEVANCE_STATUS_HISTORY_ENTITY_KIND,
    entityTable: grievanceStatusHistory,
    hiddenFromCatalog: true,
    requiredComponent: COMPONENT,
    sampleSets: GRIEVANCE_STATUS_HISTORY_SAMPLE_SETS,
    // The most recent real status entries a surface may OFFER as preview
    // subjects (no search, no load-by-id). The grievance title appears in
    // the LABEL (so an author can tell the entries apart) but not on the
    // row: the row is the entry's own columns, exactly as delivery seeds it.
    recentRecords: {
      async recent(limit) {
        const { storage } = await import("../../../storage");
        const rows = await storage.grievanceStatusHistory.listForPreview(limit);
        // One title query for the whole batch, not one per row.
        const titles = await storage.grievances.getAssignmentTitleInfoMany(
          rows.map((row) => row.grievanceId),
        );
        const out = [];
        for (const row of rows) {
          const grievanceTitle = composeGrievanceDisplayTitle(
            row.grievanceId,
            titles.get(row.grievanceId),
          );
          out.push({
            id: row.id,
            label: [
              grievanceTitle,
              row.statusName || null,
              row.date ? new Date(row.date).toISOString().slice(0, 10) : null,
            ]
              .filter(Boolean)
              .join(" — "),
            entity: {
              kind: GRIEVANCE_STATUS_HISTORY_ENTITY_KIND,
              row: {
                ...(row as unknown as Record<string, unknown>),
              },
              table: grievanceStatusHistory,
            },
          });
        }
        return out;
      },
    },
  },
  async resolve() {
    return null;
  },
});

/**
 * Settlement descriptor. `operation` is a derived extra: the settlement
 * notifier merges the event's operation (created/updated/deleted) onto
 * the row, so templates can say `was {{event.field(name="operation")}}`.
 */
registerTokenPlugin({
  metadata: {
    id: "token.grievance_settlement",
    name: "Grievance settlement",
    description: "Descriptor for the grievance settlement entity kind",
    segmentName: "__grievance_settlement",
    inputTypes: [],
    outputType: GRIEVANCE_SETTLEMENT_ENTITY_KIND,
    entityTable: grievanceSettlements,
    entityFields: ["operation", "summary", "grievance_title"],
    hiddenFromCatalog: true,
    requiredComponent: "grievance.settlement",
    sampleSets: GRIEVANCE_SETTLEMENT_SAMPLE_SETS,
    // A few real settlements a surface may OFFER as preview subjects. A
    // settlement that exists was created, so the derived `operation` (and
    // the `summary` sentence built from it) reads "created"; the amended
    // and voided wordings are covered by the personas.
    recentRecords: {
      async recent(limit) {
        const [{ storage }, { settlementSummary }] = await Promise.all([
          import("../../../storage"),
          import(
            "../../event-notifier/plugins/grievance-settlement-notifier"
          ),
        ]);
        const rows = await storage.grievanceSettlements.listForPreview(limit);
        // One title query for the whole batch, not one per row.
        const titles = await storage.grievances.getAssignmentTitleInfoMany(
          rows.map((row) => row.grievanceId),
        );
        const out = [];
        for (const row of rows) {
          const grievanceTitle = composeGrievanceDisplayTitle(
            row.grievanceId,
            titles.get(row.grievanceId),
          );
          out.push({
            id: row.id,
            label: [grievanceTitle, row.description || null]
              .filter(Boolean)
              .join(" — "),
            entity: {
              kind: GRIEVANCE_SETTLEMENT_ENTITY_KIND,
              row: {
                ...(row as unknown as Record<string, unknown>),
                operation: "created",
                grievanceTitle,
                summary: settlementSummary(
                  "created",
                  grievanceTitle,
                  row.amount,
                ),
              },
              table: grievanceSettlements,
            },
          });
        }
        return out;
      },
    },
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
  async resolve(entity, _args, ctx) {
    const e =
      tokenEntityOf(entity, GRIEVANCE_STATUS_HISTORY_ENTITY_KIND) ??
      tokenEntityOf(entity, GRIEVANCE_SETTLEMENT_ENTITY_KIND);
    const grievanceId = e?.row.grievanceId;
    if (typeof grievanceId !== "string") return null;
    return loadGrievanceEntity(ctx, grievanceId);
  },
});

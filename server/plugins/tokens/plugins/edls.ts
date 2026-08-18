import { edlsSheets } from "../../../../shared/schema/edls/schema";
import { registerTokenPlugin } from "../registry";

/**
 * Token descriptor for the EDLS sheet entity kind, used by the
 * token-templated EDLS sheet status notifier. FK columns (employer,
 * department, facility, …) auto-render the referenced display names.
 */
export const EDLS_SHEET_ENTITY_KIND = "edls_sheet";

/**
 * Human-readable label for an EDLS sheet status value (e.g. "submitted"
 * → "Submitted"). Mirrors the `status_label` derived field the notifier
 * exposes so preview and live delivery agree on the wording.
 */
function edlsStatusLabel(status: string): string {
  return status.charAt(0).toUpperCase() + status.slice(1);
}

/**
 * Long-form display date for an ISO-8601 ymd string (e.g. "2031-03-14"
 * → "March 14, 2031"). Uses UTC to avoid timezone shifts on a date-only
 * value: we want the date as stored, not adjusted to the server's local
 * zone.
 */
function edlsYmdDisplay(ymd: string): string {
  const d = new Date(`${ymd}T00:00:00Z`);
  return d.toLocaleDateString("en-US", {
    month: "long",
    day: "numeric",
    year: "numeric",
    timeZone: "UTC",
  });
}

/**
 * Named sample EDLS sheets, one per shared persona id. Values are obviously
 * fictional: a preview must never be mistaken for a real sheet record.
 */
const EDLS_SHEET_SAMPLE_SETS = [
  {
    id: "martian",
    label: "Martian",
    values: {
      title: "Sector 7 Regolith Operations",
      display_title: "Sector 7 Regolith Operations",
      status: "submitted",
      status_label: "Submitted",
      ymd: "2031-03-14",
      ymd_display: "March 14, 2031",
      worker_count: "12",
    },
  },
  {
    id: "historical",
    label: "Historical",
    values: {
      title: "Menabrea Hall Analytical Shift",
      display_title: "Menabrea Hall Analytical Shift",
      status: "approved",
      status_label: "Approved",
      ymd: "1843-12-10",
      ymd_display: "December 10, 1843",
      worker_count: "6",
    },
  },
  {
    id: "mythological",
    label: "Mythological",
    values: {
      title: "Ithaka Fleet Navigation Crew",
      display_title: "Ithaka Fleet Navigation Crew",
      status: "draft",
      status_label: "Draft",
      ymd: "1184-03-02",
      ymd_display: "March 2, 1184",
      worker_count: "20",
    },
  },
];

registerTokenPlugin({
  metadata: {
    id: "token.edls_sheet",
    name: "EDLS sheet",
    description: "Descriptor for the EDLS sheet entity kind",
    segmentName: "__edls_sheet",
    inputTypes: [],
    outputType: EDLS_SHEET_ENTITY_KIND,
    entityTable: edlsSheets,
    entityFields: ["status_label", "display_title", "ymd_display"],
    hiddenFromCatalog: true,
    requiredComponent: "edls",
    sampleSets: EDLS_SHEET_SAMPLE_SETS,
    // A few real EDLS sheets a surface may OFFER as preview subjects
    // (no search and no load-by-id — a template author is not entitled
    // to name an arbitrary record). Gated on the edls component
    // (inherited from the plugin): its tables need not exist at all
    // when the component is off.
    recentRecords: {
      async recent(limit) {
        const { storage } = await import("../../../storage");
        const rows = await storage.edlsSheets.listForPreview(limit);
        return rows.map((row) => {
          const displayTitle = row.title;
          const statusLabel = edlsStatusLabel(row.status);
          const ymdDisplay = edlsYmdDisplay(row.ymd);
          return {
            id: row.id,
            label: [displayTitle, statusLabel, row.ymd]
              .filter(Boolean)
              .join(" — "),
            entity: {
              kind: EDLS_SHEET_ENTITY_KIND,
              row: {
                ...(row as unknown as Record<string, unknown>),
                display_title: displayTitle,
                status_label: statusLabel,
                ymd_display: ymdDisplay,
                worker_count: String(row.workerCount),
              },
              table: edlsSheets,
            },
          };
        });
      },
    },
  },
  async resolve() {
    return null;
  },
});

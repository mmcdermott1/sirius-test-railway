import { edlsSheets } from "../../../../shared/schema/edls/schema";
import { registerTokenPlugin } from "../registry";

/**
 * Token descriptor for the EDLS sheet entity kind, used by the
 * token-templated EDLS sheet status notifier. FK columns (employer,
 * department, facility, …) auto-render the referenced display names.
 */
export const EDLS_SHEET_ENTITY_KIND = "edls_sheet";

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
      status: "lock",
      status_label: "Locked",
      ymd: "2031-03-14",
      ymd_display: "2031-03-14",
      worker_count: "12",
    },
  },
  {
    id: "historical",
    label: "Historical",
    values: {
      title: "Menabrea Hall Analytical Shift",
      display_title: "Menabrea Hall Analytical Shift",
      status: "request",
      status_label: "Request",
      ymd: "1843-12-10",
      ymd_display: "1843-12-10",
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
      ymd_display: "1184-03-02",
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
    // Derived extras, not columns — each one a presentation of the sheet's
    // OWN data: the status label ("Locked", not "lock"), the legacy display
    // name (title, else "Sheet <id-prefix>"), and the date exactly as stored.
    // Every surface that builds a sheet composes them with the same helpers,
    // so a preview renders what delivery renders.
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
        // The notifier owns the derived wording; a preview that composed it
        // separately would drift from what delivery actually sends.
        const [
          { storage },
          { edlsStatusLabel, edlsSheetDisplayTitle, edlsYmdDisplay },
        ] = await Promise.all([
          import("../../../storage"),
          import("../../event-notifier/plugins/edls-sheet-status-notifier"),
        ]);
        const rows = await storage.edlsSheets.listForPreview(limit);
        return rows.map((row) => {
          const displayTitle = edlsSheetDisplayTitle(row.id, row.title);
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

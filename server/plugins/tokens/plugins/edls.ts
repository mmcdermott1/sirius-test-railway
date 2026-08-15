import { edlsSheets } from "../../../../shared/schema/edls/schema";
import { registerTokenPlugin } from "../registry";

/**
 * Token descriptor for the EDLS sheet entity kind, used by the
 * token-templated EDLS sheet status notifier. FK columns (employer,
 * department, facility, …) auto-render the referenced display names.
 */
export const EDLS_SHEET_ENTITY_KIND = "edls_sheet";

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
  },
  async resolve() {
    return null;
  },
});

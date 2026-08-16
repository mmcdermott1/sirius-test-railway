import { useMemo } from "react";
import { Form as RjsfForm } from "@rjsf/shadcn";
import { customizeValidator } from "@rjsf/validator-ajv8";
import type { FormProps, IChangeEvent } from "@rjsf/core";
import type {
  RJSFSchema,
  UiSchema,
  RegistryWidgetsType,
  RegistryFieldsType,
} from "@rjsf/utils";
import type { JsonSchema } from "@shared/json-schema-form";
import { RemoteOptionsWidget } from "./widgets/RemoteOptionsWidget";
import { SelfOptionsWidget } from "./widgets/SelfOptionsWidget";
import { IconWidget } from "./widgets/IconWidget";
import { ColorWidget } from "./widgets/ColorWidget";
import { EnumSelectWidget } from "./widgets/EnumSelectWidget";
import { HtmlEditorWidget } from "./widgets/HtmlEditorWidget";
import { TokenTemplateWidget } from "./widgets/TokenTemplateWidget";
import { ArrayTableField } from "./fields/ArrayTableField";
import { StaffRecipientsField } from "./fields/StaffRecipientsField";
import { SystemRolesField } from "./fields/SystemRolesField";
import { WorkerBanPluginsField } from "./fields/WorkerBanPluginsField";

const validator = customizeValidator({
  ajvOptionsOverrides: { $data: true },
});

/**
 * Form context payload that custom widgets can read. Pass anything
 * widgets need (e.g. the list of sibling rows for the self-options
 * parent picker, or the id of the row being edited).
 */
export interface SchemaFormContext {
  /** Items in the same options collection (for SelfOptionsWidget). */
  selfItems?: Array<{ id: string; name: string }>;
  /** Id of the row currently being edited (excluded from self-pickers). */
  editingId?: string | null;
  /**
   * The live form data of the config being edited (for widgets whose
   * behavior depends on sibling fields, e.g. TokenTemplateWidget's
   * recipient-kind-dependent default placeholders).
   */
  configData?: Record<string, unknown>;
  /**
   * Deep-set one dotted path (e.g. "templates.email.subject") into the
   * live form data — lets a widget-hosted editor (Template Studio) edit
   * sibling fields outside its own RJSF field.
   */
  updateConfigData?: (path: string, value: unknown) => void;
}

export interface SchemaFormProps<T = Record<string, unknown>>
  extends Omit<
    FormProps<T, RJSFSchema, SchemaFormContext>,
    "validator" | "widgets" | "schema"
  > {
  /**
   * Accept either our project-internal `JsonSchema` (with vendor
   * extension keys) or RJSF's own `RJSFSchema`. Both are structurally
   * compatible at runtime; we cast to RJSFSchema before handing to the
   * underlying form.
   */
  schema: JsonSchema | RJSFSchema;
  /**
   * Extra widgets to merge on top of the default registry. Use this
   * when a single page needs an additional bespoke widget; vendor-key
   * widgets are wired automatically via uiSchema mapping below.
   */
  extraWidgets?: RegistryWidgetsType<T, RJSFSchema, SchemaFormContext>;
}

/**
 * Build a ui:widget mapping for any property whose schema carries one
 * of our vendor extension keys (x-options-resource, x-options-self).
 * RJSF's uiSchema is what tells it which widget to render, so we
 * synthesize entries here rather than asking every caller to do it.
 */
function buildVendorUiSchema(
  schema: RJSFSchema,
  inherited: UiSchema = {},
): UiSchema {
  if (!schema || typeof schema !== "object") return inherited;
  const out: UiSchema = { ...inherited };
  const props = (schema as { properties?: Record<string, RJSFSchema> }).properties;
  if (!props) return out;
  for (const [name, sub] of Object.entries(props)) {
    const subAny = sub as Record<string, unknown>;
    const existing = (out[name] as UiSchema | undefined) ?? {};
    let widget: string | undefined;
    let field: string | undefined;
    if (subAny["x-widget"] === "array-table") {
      field = "arrayTable";
    } else if (subAny["x-widget"] === "staff-recipients") {
      field = "staffRecipients";
    } else if (subAny["x-widget"] === "system-roles") {
      field = "systemRoles";
    } else if (subAny["x-widget"] === "worker-ban-plugins") {
      field = "workerBanPlugins";
    } else if (typeof subAny["x-options-resource"] === "string") {
      const isArray = (sub as RJSFSchema).type === "array";
      widget = isArray ? "remoteOptionsMulti" : "remoteOptions";
    } else if (subAny["x-options-self"] === true) {
      widget = "selfOptions";
    } else if (subAny["x-widget"] === "icon") {
      widget = "icon";
    } else if (subAny["x-widget"] === "color") {
      widget = "color";
    } else if (subAny["x-widget"] === "token-template") {
      // Assign directly (leave `widget` unset) so the generic
      // assignment below can't overwrite the ui:options built here.
      out[name] = {
        ...existing,
        "ui:widget": "tokenTemplate",
        "ui:options": {
          ...((existing["ui:options"] as Record<string, unknown>) ?? {}),
          catalogUrl: subAny["x-token-catalog-url"],
          mode: subAny["x-token-template-mode"] ?? "line",
          defaultPath: subAny["x-token-default-path"],
          defaultsDeps: subAny["x-token-defaults-deps"],
        },
      };
    }
    if (field && !existing["ui:field"]) {
      out[name] = { ...existing, "ui:field": field };
    } else if (widget && !existing["ui:widget"]) {
      out[name] = { ...existing, "ui:widget": widget };
    }
    if ((sub as RJSFSchema).type === "object") {
      out[name] = buildVendorUiSchema(sub, out[name] as UiSchema);
    }
  }
  return out;
}

const baseWidgets = {
  // Override rjsf-shadcn's default single-enum widget. Its FancySelect
  // popover isn't portaled, so inside SchemaFormDialog it triggers a
  // phantom scrollbar that, when clicked, blurs the popover closed.
  // Our EnumSelectWidget uses Radix Select (portal -> document.body)
  // and matches the rjsf encode/decode contract. Multi-select still
  // falls through to rjsf-shadcn's FancyMultiSelect since Radix
  // Select is single-value only — none of the current Configure
  // modals use array-of-enum.
  SelectWidget: EnumSelectWidget,
  remoteOptions: RemoteOptionsWidget,
  remoteOptionsMulti: RemoteOptionsWidget,
  selfOptions: SelfOptionsWidget,
  icon: IconWidget,
  color: ColorWidget,
  htmlEditor: HtmlEditorWidget,
  tokenTemplate: TokenTemplateWidget,
} as unknown as RegistryWidgetsType;

const baseFields = {
  arrayTable: ArrayTableField,
  staffRecipients: StaffRecipientsField,
  systemRoles: SystemRolesField,
  workerBanPlugins: WorkerBanPluginsField,
} as unknown as RegistryFieldsType;

/**
 * Thin wrapper over `@rjsf/shadcn` Form that wires our AJV validator,
 * custom widgets, and vendor-extension uiSchema mapping.
 *
 * Pass a JSON Schema, optionally a uiSchema (merged on top of the one
 * inferred from vendor keys), the current form data, and onChange/
 * onSubmit handlers — same shape as a normal RJSF Form.
 */
export function SchemaForm({
  schema,
  uiSchema,
  extraWidgets,
  ...rest
}: SchemaFormProps) {
  const rjsfSchema = schema as RJSFSchema;
  const inferred = useMemo(
    () => buildVendorUiSchema(rjsfSchema, uiSchema ?? {}),
    [rjsfSchema, uiSchema],
  );
  const widgets = useMemo<RegistryWidgetsType>(
    () => ({ ...baseWidgets, ...(extraWidgets ?? {}) }),
    [extraWidgets],
  );
  return (
    <RjsfForm
      schema={rjsfSchema}
      uiSchema={inferred}
      validator={validator}
      widgets={widgets}
      fields={baseFields}
      liveValidate={false}
      showErrorList={false}
      // Don't pre-pad arrays to satisfy `minItems`. By default rjsf
      // fills the array with `computeDefaults(items)` entries, which
      // for `items: { type: "string" }` (no default) yields
      // `[undefined]`. That undefined sits at index 0 and later AJV
      // submit-time validation rejects it as "must be string", even
      // after the user has appended real values. Start arrays empty
      // and let user actions / explicit defaults populate them.
      experimental_defaultFormStateBehavior={{
        arrayMinItems: { populate: "never" },
      }}
      {...rest}
    />
  );
}

export type { IChangeEvent };

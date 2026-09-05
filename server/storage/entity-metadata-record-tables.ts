import { getTableName, is } from "drizzle-orm";
import { PgTable, type TableConfig } from "drizzle-orm/pg-core";
import * as coreSchema from "@shared/schema";
import * as t631InterviewSchema from "@shared/schema/sitespecific/t631/interviews-schema";
import {
  getLoggedTableNames,
  getModulesNamingTablesAtRuntime,
} from "./middleware/logging";

/**
 * Every database table that carries provenance, and how to reach one of its
 * records.
 *
 * `entity_metadata.table_name` holds a RAW table name — whatever the storage
 * logging config that wrote the row declared. That is enough to store a row
 * and enough to read one back for the record that asked, but not enough to do
 * anything ABOUT the table: a list cannot say what kind of record it is
 * looking at, cannot link to it, and cannot count the records that have no
 * provenance yet, because nothing maps that name onto a table or a page.
 *
 * This is that map. It is the twin of the note and file context table
 * bindings (`./entity-notes-context-tables.ts`,
 * `./entity-files-context-tables.ts`) with one difference: those are keyed by
 * a context id the registry invented, and this is keyed by the table name
 * itself, because that is what a provenance row stores.
 *
 * Two things are declared per table and nothing else:
 *
 *  - **A label.** What to call the table where a person reads it.
 *  - **A page, or the absence of one.** `hrefTemplate` is where a record of
 *    this table lives, `{id}` standing for the record's id — or `null`,
 *    stated on purpose, for a table whose records have no page. Most child
 *    tables are `null`: an address, a crew assignment or a subsidiary config
 *    row is reached through its parent, not by itself.
 *
 * **No component is declared here.** A component-owned table does not exist
 * at all while its component is off, and existence is what a count or an
 * anti-join actually needs to know. Asking the component registry as well
 * would be a second answer to the same question, free to disagree with the
 * database; instead the storage layer asks the database
 * (`entityMetadataStorage.checkTable`), which is the same judgement the
 * orphan sweep is held to.
 */

export interface MetadataRecordTable {
  /** What to call this table where a person reads it. */
  label: string;
  /**
   * Where one of this table's records lives, with `{id}` standing for the
   * record id — or null when its records have no page of their own.
   */
  hrefTemplate: string | null;
}

/**
 * The declared tables, keyed by the raw table name a provenance row stores.
 *
 * Every table any storage logging config names must appear here; the boot
 * assertion below refuses to let the two drift apart. Adding a logged table
 * therefore means deciding, once, what to call it and whether it has a page.
 */
export const entityMetadataRecordTables: Record<string, MetadataRecordTable> = {
  bargaining_units: { label: "Bargaining Units", hrefTemplate: "/bargaining-units/{id}" },
  bulk_messages: { label: "Bulk Messages", hrefTemplate: "/bulk/{id}" },
  bulk_messages_email: { label: "Bulk Message Email Settings", hrefTemplate: null },
  bulk_messages_inapp: { label: "Bulk Message In-App Settings", hrefTemplate: null },
  bulk_messages_postal: { label: "Bulk Message Postal Settings", hrefTemplate: null },
  bulk_messages_sms: { label: "Bulk Message SMS Settings", hrefTemplate: null },
  bulk_participants: { label: "Bulk Message Participants", hrefTemplate: null },
  cardcheck_definitions: {
    label: "Card Check Definitions",
    hrefTemplate: "/cardcheck-definitions/{id}",
  },
  cardchecks: { label: "Card Checks", hrefTemplate: "/cardchecks/{id}" },
  comm: { label: "Communications", hrefTemplate: "/comm/{id}" },
  comm_tags: { label: "Communication Tags", hrefTemplate: null },
  companies: { label: "Companies", hrefTemplate: "/companies/{id}" },
  contact_phone: { label: "Phone Numbers", hrefTemplate: null },
  contact_postal: { label: "Addresses", hrefTemplate: null },
  contacts: { label: "Contacts", hrefTemplate: null },
  contract_articles: { label: "Contract Articles", hrefTemplate: null },
  contract_sections: { label: "Contract Sections", hrefTemplate: null },
  contracts: { label: "Contracts", hrefTemplate: "/contract/{id}" },
  dispatch_job_employer_contacts: {
    label: "Dispatch Job Employer Contacts",
    hrefTemplate: null,
  },
  dispatch_job_facility: { label: "Dispatch Job Facilities", hrefTemplate: null },
  dispatch_job_fore: { label: "Dispatch Job Foremen", hrefTemplate: null },
  dispatch_job_group: { label: "Dispatch Job Groups", hrefTemplate: "/dispatch/job_group/{id}" },
  dispatch_jobs: { label: "Dispatch Jobs", hrefTemplate: "/dispatch/job/{id}" },
  dispatches: { label: "Dispatches", hrefTemplate: "/dispatch/{id}" },
  edls_assignments: { label: "EDLS Assignments", hrefTemplate: null },
  edls_crews: { label: "EDLS Crews", hrefTemplate: null },
  edls_sheets: { label: "EDLS Sheets", hrefTemplate: "/edls/sheet/{id}" },
  employer_companies: { label: "Employer Companies", hrefTemplate: null },
  employer_contacts: { label: "Employer Contacts", hrefTemplate: "/employer-contacts/{id}" },
  employer_policy_history: { label: "Employer Policy History", hrefTemplate: null },
  employers: { label: "Employers", hrefTemplate: "/employers/{id}" },
  entity_files: { label: "Record Attachments", hrefTemplate: null },
  entity_notes: { label: "Record Notes", hrefTemplate: null },
  esigs: { label: "Signatures", hrefTemplate: null },
  event_occurrences: { label: "Event Occurrences", hrefTemplate: null },
  event_participants: { label: "Event Participants", hrefTemplate: null },
  events: { label: "Events", hrefTemplate: "/events/{id}" },
  facilities: { label: "Facilities", hrefTemplate: "/facility/{id}" },
  files: { label: "Files", hrefTemplate: null },
  grievance_complaints: { label: "Grievance Complaints", hrefTemplate: null },
  grievance_contracts: { label: "Grievance Contract Citations", hrefTemplate: null },
  grievance_employers: { label: "Grievance Employers", hrefTemplate: null },
  grievance_remedies: { label: "Grievance Remedies", hrefTemplate: null },
  grievance_settlements: { label: "Grievance Settlements", hrefTemplate: null },
  grievance_status_history: { label: "Grievance Status History", hrefTemplate: null },
  grievance_timeline_template_steps: {
    label: "Grievance Timeline Template Steps",
    hrefTemplate: null,
  },
  grievance_timeline_templates: {
    label: "Grievance Timeline Templates",
    hrefTemplate: "/grievance-timeline-template/{id}",
  },
  grievance_users: { label: "Grievance Staff", hrefTemplate: null },
  grievance_workers: { label: "Grievance Workers", hrefTemplate: null },
  grievances: { label: "Grievances", hrefTemplate: "/grievance/{id}" },
  ledger_accounts: { label: "Ledger Accounts", hrefTemplate: "/ledger/accounts/{id}" },
  ledger_gateway_customers: { label: "Payment Gateway Customers", hrefTemplate: null },
  ledger_payment_batches: {
    label: "Payment Batches",
    hrefTemplate: "/ledger/payment-batch/{id}",
  },
  ledger_paymentmethods: { label: "Payment Methods", hrefTemplate: null },
  ledger_payments: { label: "Payments", hrefTemplate: "/ledger/payment/{id}" },
  // A configuration is read and edited on its kind's admin page
  // (/admin/plugin-configs/<kind>), which is a list, not a page per row.
  plugin_configs: { label: "Plugin Configurations", hrefTemplate: null },
  policies: { label: "Access Policies", hrefTemplate: "/policies/{id}" },
  role_permissions: { label: "Role Permissions", hrefTemplate: null },
  roles: { label: "Roles", hrefTemplate: null },
  sessions: { label: "Sessions", hrefTemplate: null },
  sftp_client_destinations: {
    label: "SFTP Client Destinations",
    hrefTemplate: "/config/sftp/client/{id}",
  },
  sitespecific_bao_employer_immediate_eligibility: {
    label: "BAO Immediate Eligibility",
    hrefTemplate: null,
  },
  sitespecific_btu_csg: {
    label: "BTU Class Size Grievances",
    hrefTemplate: "/sitespecific/btu/csg/{id}",
  },
  sitespecific_btu_employer_map: { label: "BTU Employer Map", hrefTemplate: null },
  sitespecific_btu_political_officials: {
    label: "BTU Political Officials",
    hrefTemplate: null,
  },
  sitespecific_freeman_crewleads: { label: "Freeman Crew Leads", hrefTemplate: null },
  sitespecific_t631_job_interviews: { label: "T631 Job Interviews", hrefTemplate: null },
  snapshots: { label: "Snapshots", hrefTemplate: null },
  trust_benefit_eligibility_exemptions: {
    label: "Benefit Eligibility Exemptions",
    hrefTemplate: null,
  },
  trust_benefits: { label: "Trust Benefits", hrefTemplate: "/trust-benefits/{id}" },
  trust_provider_contacts: {
    label: "Trust Provider Contacts",
    hrefTemplate: "/trust-provider-contacts/{id}",
  },
  trust_providers: { label: "Trust Providers", hrefTemplate: "/trust/provider/{id}" },
  trust_wmb: { label: "Worker Monthly Benefits", hrefTemplate: null },
  user_roles: { label: "User Roles", hrefTemplate: null },
  users: { label: "Users", hrefTemplate: "/users/{id}" },
  variables: { label: "Configuration Variables", hrefTemplate: null },
  wizards: { label: "Wizards", hrefTemplate: "/wizards/{id}" },
  worker_aat: { label: "Worker Access Tokens", hrefTemplate: null },
  worker_bans: { label: "Worker Bans", hrefTemplate: null },
  worker_certifications: { label: "Worker Certifications", hrefTemplate: null },
  worker_dispatch_asi: { label: "Worker Dispatch ASI", hrefTemplate: null },
  worker_dispatch_department: { label: "Worker Dispatch Departments", hrefTemplate: null },
  worker_dispatch_dnc: { label: "Worker Do-Not-Call", hrefTemplate: null },
  worker_dispatch_eba: { label: "Worker Dispatch EBA", hrefTemplate: null },
  worker_dispatch_hfe: { label: "Worker Dispatch HFE", hrefTemplate: null },
  worker_dispatch_status: { label: "Worker Dispatch Status", hrefTemplate: null },
  worker_edls: { label: "Worker EDLS Settings", hrefTemplate: null },
  worker_hours: { label: "Worker Hours", hrefTemplate: "/hours/{id}" },
  worker_ids: { label: "Worker Identifiers", hrefTemplate: null },
  worker_msh: { label: "Worker Member Status History", hrefTemplate: null },
  worker_ratings: { label: "Worker Ratings", hrefTemplate: null },
  worker_relations: { label: "Worker Relations", hrefTemplate: null },
  worker_skills: { label: "Worker Skills", hrefTemplate: null },
  worker_steward_assignments: { label: "Worker Steward Assignments", hrefTemplate: null },
  worker_tos: { label: "Worker Terms Acceptance", hrefTemplate: null },
  worker_trust_elections: { label: "Trust Elections", hrefTemplate: "/trust/election/{id}" },
  worker_wsh: { label: "Worker Work Status History", hrefTemplate: null },
  workers: { label: "Workers", hrefTemplate: "/workers/{id}" },
};

/**
 * Every table object the schema declares, by its real SQL name.
 *
 * Built rather than written out: the registry above already names each table,
 * and repeating the Drizzle object beside the name would be a second list to
 * keep in step. The component-owned schemas that live outside the main barrel
 * are folded in explicitly — a table only reachable through its own component
 * file is still a table a provenance row can name.
 */
const schemaTablesByName: Map<string, PgTable<TableConfig>> = (() => {
  const byName = new Map<string, PgTable<TableConfig>>();
  for (const module of [coreSchema, t631InterviewSchema]) {
    for (const value of Object.values(module)) {
      if (is(value, PgTable)) {
        byName.set(getTableName(value), value as PgTable<TableConfig>);
      }
    }
  }
  return byName;
})();

/** The Drizzle table a provenance row's `table_name` refers to, if declared. */
export function getMetadataRecordTable(
  tableName: string,
): PgTable<TableConfig> | undefined {
  if (!entityMetadataRecordTables[tableName]) return undefined;
  return schemaTablesByName.get(tableName);
}

/** Whether this table carries provenance at all. */
export function isMetadataRecordTable(tableName: string): boolean {
  return Boolean(entityMetadataRecordTables[tableName]);
}

/**
 * Where one record of this table lives, or null when it has no page — either
 * because the table declares none or because the table is not declared here
 * at all (a row left behind by a config that has since gone).
 */
export function metadataRecordHref(tableName: string, entityId: string): string | null {
  const template = entityMetadataRecordTables[tableName]?.hrefTemplate;
  if (!template) return null;
  return template.replace("{id}", encodeURIComponent(entityId));
}

/** The declared tables, in label order, for a list to offer or count. */
export function listMetadataRecordTables(): Array<
  MetadataRecordTable & { tableName: string }
> {
  return Object.entries(entityMetadataRecordTables)
    .map(([tableName, table]) => ({ tableName, ...table }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

/**
 * Every logged table must be declared, and every declared table must be a
 * real table.
 *
 * A storage logging config names the table its provenance rows will claim. If
 * that table is not declared here, its rows appear in the admin list as a bare
 * name with no label and no link, and the backfill cannot count or fill it —
 * a silent hole rather than a failure. So the check runs at boot, the way the
 * note and file context bindings are checked, and refuses to start instead.
 *
 * The reverse direction is checked too: a declared table that the schema does
 * not define cannot be counted or anti-joined, so a typo is caught here rather
 * than at the moment an administrator presses the button.
 */
export function assertEntityMetadataRecordTablesComplete(): void {
  const problems: string[] = [];

  const undeclared = getLoggedTableNames().filter((name) => !entityMetadataRecordTables[name]);
  if (undeclared.length > 0) {
    problems.push(
      `named by a storage logging config but not declared: ${undeclared.join(", ")}`,
    );
  }

  const unknown = Object.keys(entityMetadataRecordTables).filter(
    (name) => !schemaTablesByName.has(name),
  );
  if (unknown.length > 0) {
    problems.push(`declared but not defined in the schema: ${unknown.join(", ")}`);
  }

  if (problems.length === 0) return;

  // A module whose table is decided by the call has no name to check, so the
  // failure says which ones this check could not see — the answer to "but I
  // did declare it" when the table came from a resolver.
  const runtimeNamed = getModulesNamingTablesAtRuntime();
  const caveat =
    runtimeNamed.length > 0
      ? ` (these modules name their table at call time and cannot be enumerated, so their tables must be declared by hand: ${runtimeNamed.join(", ")})`
      : "";

  throw new Error(
    `server/storage/entity-metadata-record-tables.ts is out of step — ${problems.join("; ")}${caveat}`,
  );
}

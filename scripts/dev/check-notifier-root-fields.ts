/**
 * Author-time check: a notifier's token roots must describe records that
 * really exist.
 *
 * A root is what a template author writes after `{{`. The editor offers its
 * fields, save-time validation accepts them, and delivery renders them — all
 * three from the same catalog, which is built from what the root DECLARES, not
 * from what its `build()` actually produces. So a declaration that lies costs
 * nothing at author time and everything at delivery time: the token validates,
 * previews fine (previews seed real rows) and arrives blank in the message.
 *
 * Two ways to lie, both checked here:
 *
 *   1. NAME. The root name is the only clue an author has about what the
 *      record is. `grievance_status` holding a `grievance_status_history` row
 *      reads like the grievance's status — so authors wrote
 *      `grievance_status.field(name="grievance_title")` and nobody blinked.
 *      The name must BE the entity kind.
 *
 *   2. FLATTENED EXTRAS. `fields` widens the catalog with values `build()`
 *      merges onto the row. Every one is a field that exists only as long as
 *      the seeding code remembers it, and one named after a related record's
 *      value ("grievance_title") claims the record holds something it does
 *      not. Reach the related record instead.
 *
 * Roots that predate the rule are listed in the exemption maps below with a
 * reason, so the list is a visible to-do rather than a silent regression.
 *
 * Run: npx tsx scripts/dev/check-notifier-root-fields.ts
 */
import { getTableColumns } from "drizzle-orm";
// The event-notifier barrel first: importing the tokens barrel ahead of it
// re-enters the shared plugin registry mid-initialization.
import { initializeEventNotifierPluginSystem } from "../../server/plugins/event-notifier";
import { eventNotifierRegistry } from "../../server/plugins/event-notifier/registry";
import { initializeTokenPluginSystem } from "../../server/plugins/tokens";
import { tokenPluginRegistry } from "../../server/plugins/tokens/registry";

/**
 * Roots whose name does not match their entity kind. Each entry is a message
 * an admin can misread today; clearing one means renaming the root and
 * shipping a stored-template rewrite alongside it (see
 * `server/plugins/event-notifier/template-token-migrations.ts`).
 */
const NAME_EXEMPT: Record<string, string> = {
  "dispatch-status-notifier:dispatch":
    'holds a `dispatch_worker_status` row — "dispatch" reads like the job. ' +
    "Pending conversion, see .local/tasks/notifier-token-roots-remaining.md",
};

/**
 * Roots that flatten related-record values onto their row. Clearing one means
 * pointing the templates at the related record instead — same rewrite
 * requirement as above.
 */
const FLATTENED_FIELDS_EXEMPT: Record<string, string> = {
  "grievance-settlement:grievance_settlement":
    "`grievance_title` belongs to the linked grievance; `operation`/`summary` " +
    "are genuinely derived and want a home that says so. " +
    "See .local/tasks/notifier-token-roots-remaining.md",
  "edls-sheet-status-notifier:edls_sheet":
    "`display_title`/`ymd_display` are presentation of the sheet's own " +
    "columns; `status_label` restates the status FK. " +
    "See .local/tasks/notifier-token-roots-remaining.md",
  "dispatch-status-notifier:dispatch":
    "`status_label` restates the row's status; the same conversion that " +
    "renames this root should retire it. " +
    "See .local/tasks/notifier-token-roots-remaining.md",
  "dispatch-fore-notifier:dispatch_fore":
    "`job_title`/`employer_name` belong to the linked job and employer; " +
    "`action_label` is derived from the event. " +
    "See .local/tasks/notifier-token-roots-remaining.md",
};

let failures = 0;
function fail(label: string, detail: string) {
  console.log(`FAIL: ${label}`);
  console.log(`  ${detail}`);
  failures++;
}

function main() {
  initializeEventNotifierPluginSystem();
  initializeTokenPluginSystem();

  // Descriptor per entity kind: the plugin that declares the kind's table.
  // Component gating is irrelevant here — this is a check about the source.
  const tableForKind = new Map<string, Set<string>>();
  for (const p of tokenPluginRegistry.list()) {
    const table = p.metadata.entityTable;
    if (!table) continue;
    const columns = new Set(
      Object.values(getTableColumns(table)).map((col) => col.name),
    );
    tableForKind.set(p.metadata.outputType, columns);
  }

  const seenExemptions = new Set<string>();
  let rootCount = 0;

  for (const plugin of eventNotifierRegistry.list()) {
    for (const root of plugin.tokenTemplates?.roots ?? []) {
      rootCount++;
      const key = `${plugin.id}:${root.name}`;
      const label = `${plugin.id} → {{${root.name}}}`;
      const columns = tableForKind.get(root.kind);

      // A kind with no table-backed descriptor has an OPEN catalog: every
      // field name an author types validates, and delivery decides. Nothing
      // below can be checked, so refuse the root rather than let it through.
      if (!columns) {
        fail(
          label,
          `entity kind "${root.kind}" has no descriptor declaring an entityTable, ` +
            `so its field catalog is open and every field name silently validates`,
        );
        continue;
      }

      if (root.name !== root.kind) {
        if (NAME_EXEMPT[key]) {
          seenExemptions.add(key);
        } else {
          fail(
            label,
            `root name must be its entity kind "${root.kind}" — "${root.name}" ` +
              `describes the record as something it is not`,
          );
          continue;
        }
      }

      const extras = root.fields ?? [];
      const collides = extras.filter((f) => columns.has(f));
      if (collides.length > 0) {
        fail(
          label,
          `declares extras that are already columns of ${root.kind}: ` +
            `${collides.join(", ")} — drop them, the column is offered anyway`,
        );
        continue;
      }

      if (extras.length > 0) {
        if (FLATTENED_FIELDS_EXEMPT[key]) {
          seenExemptions.add(key);
        } else {
          fail(
            label,
            `declares flattened extras [${extras.join(", ")}] that no column of ` +
              `${root.kind} backs; reach the related record instead, or add an ` +
              `exemption with a reason if the value is genuinely derived`,
          );
          continue;
        }
      }

      const note = seenExemptions.has(key) ? " (exempt)" : "";
      console.log(`PASS: ${label} — ${root.kind}${note}`);
    }
  }

  // A stale exemption is a rule that quietly stopped applying.
  for (const key of [
    ...Object.keys(NAME_EXEMPT),
    ...Object.keys(FLATTENED_FIELDS_EXEMPT),
  ]) {
    if (!seenExemptions.has(key)) {
      fail(key, "exemption no longer applies to any root — remove it");
    }
  }

  console.log(`\nChecked ${rootCount} notifier record roots.`);
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main();

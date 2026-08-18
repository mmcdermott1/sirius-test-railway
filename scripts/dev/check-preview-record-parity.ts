/**
 * Real-record preview parity: the row the Template Studio's record picker
 * seeds a preview with must BE the row delivery would build.
 *
 * Each previewable kind's `previewEntity.load()` composes the same derived
 * extras delivery composes (status labels, display-title fallbacks, the
 * settlement summary sentence) by calling the owning notifier's shared
 * helpers — but nothing structural forces the two to stay in step. If a
 * notifier changes how it builds its root and the preview loader is not
 * updated, the preview renders a value delivery never sends, and the author
 * has no way to notice.
 *
 * So this check renders each previewable kind BOTH ways against the same
 * real record — once through the preview loader, once through the owning
 * notifier's root `build()` fed a payload synthesized from that record —
 * and fails when the two rows differ on any field the token catalog
 * advertises (the kind's table columns plus its declared derived extras
 * plus the root's own extras).
 *
 * Event-time extras with no standing value (a fore membership's
 * added/removed `action`, a settlement's created/updated/deleted
 * `operation`) are NOT skipped: the record exists, so the event it stands
 * for is the one that brought it into being, and both sides are compared
 * on that wording — the same wording the picker deliberately shows.
 *
 * Coverage is closed both ways:
 *   - every notifier root whose kind is previewable must have a payload
 *     synthesizer here, or the check fails (a new root cannot slip in
 *     uncompared);
 *   - every previewable kind with NO owning notifier root must be named
 *     in RECIPIENT_ONLY_KINDS, or the check fails (a kind cannot be
 *     skipped silently).
 *
 * Needs a dev database with at least one record per compared kind — the
 * same data the picker itself needs to offer anything.
 *
 * Run: npx tsx scripts/dev/check-preview-record-parity.ts
 */
import { getTableColumns } from "drizzle-orm";
// The event-notifier barrel first: importing the tokens barrel ahead of it
// re-enters the shared plugin registry mid-initialization.
import { initializeEventNotifierPluginSystem } from "../../server/plugins/event-notifier";
import { eventNotifierRegistry } from "../../server/plugins/event-notifier/registry";
import { initializeTokenPluginSystem } from "../../server/plugins/tokens";
import { tokenPluginRegistry } from "../../server/plugins/tokens/registry";
import { resolveRowKey } from "../../server/plugins/tokens/plugins/field";
import type { TokenEntity } from "../../server/plugins/tokens/types";
import type { IStorage } from "../../server/storage";

/**
 * Previewable kinds that are recipients, not notifier subjects: no
 * notifier seeds them as a record root, so there is no root builder to
 * compare against. Naming one here is a claim that stays true only while
 * no notifier grows a root of this kind — the closure check below removes
 * the entry from consideration the moment one does.
 */
const RECIPIENT_ONLY_KINDS = new Set(["contact", "worker", "employer"]);

/**
 * How to reconstruct, from a standing record, the event payload the
 * notifier's root builder would have been handed for the event that
 * brought that record into being. Keyed by `${notifierId}:${rootName}`.
 *
 * Event-time extras use the wording the picker deliberately shows for a
 * standing record: a membership that exists was "added", a settlement
 * that exists was "created".
 */
const PAYLOAD_SYNTHESIZERS: Record<
  string,
  (storage: IStorage, id: string) => Promise<unknown | null>
> = {
  "dispatch-status-notifier:dispatch_worker_status": async (_storage, id) => {
    const { createWorkerDispatchStatusStorage } = await import(
      "../../server/storage/dispatch/worker-status"
    );
    const row = await createWorkerDispatchStatusStorage().get(id);
    return row ? { row } : null;
  },
  "dispatch-fore-notifier:dispatch_fore": async (storage, id) => {
    const row = await storage.dispatchJobFore.get(id);
    // The membership exists ⇒ the event it stands for added it.
    return row ? { fore: row, action: "added" } : null;
  },
  "dispatch-fore-notifier:dispatch_job": async (storage, id) => {
    const job = await storage.dispatchJobs.get(id);
    return job ? { job } : null;
  },
  "edls-sheet-status-notifier:edls_sheet": async (storage, id) => {
    const sheet = await storage.edlsSheets.get(id);
    // The transition this standing sheet represents arrived at its
    // current status.
    return sheet ? { sheet, newStatus: sheet.status } : null;
  },
  "grievance-settlement:grievance_settlement": async (storage, id) => {
    const row = await storage.grievanceSettlements.getById(id);
    if (!row) return null;
    const parts = await storage.grievances.getAssignmentTitleInfo(
      row.grievanceId,
    );
    // The settlement exists ⇒ the event it stands for created it.
    return {
      grievanceId: row.grievanceId,
      operation: "created",
      row,
      grievanceTitleParts: parts ?? null,
    };
  },
  "grievance-settlement:grievance": async (storage, id) => {
    const grievance = await storage.grievances.get(id);
    if (!grievance) return null;
    const parts = await storage.grievances.getAssignmentTitleInfo(id);
    return { grievance, grievanceTitleParts: parts ?? null };
  },
  "grievance-status-notifier:grievance_status_history": async (storage, id) => {
    const row = await storage.grievanceStatusHistory.getById(id);
    if (!row) return null;
    return { grievanceId: row.grievanceId, newStatusHistoryId: row.id };
  },
  "grievance-status-notifier:grievance": async (_storage, id) => {
    return { grievanceId: id };
  },
  "sitespecific_t631_interview:sitespecific_t631_interview": async (
    _storage,
    id,
  ) => {
    return { interviewId: id };
  },
};

let failures = 0;
function fail(label: string, detail: string) {
  console.log(`FAIL: ${label}`);
  console.log(`  ${detail}`);
  failures++;
}

/**
 * One field's value off an entity, resolved exactly the way the `field`
 * token resolves it (snake_case or camelCase, direct row keys first,
 * then the declared table's columns), then canonicalized for comparison.
 */
function fieldValue(entity: TokenEntity, name: string): string | null {
  const key = resolveRowKey(entity, name);
  if (!key) return null;
  const value = entity.row[key];
  if (value == null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

async function main() {
  initializeEventNotifierPluginSystem();
  initializeTokenPluginSystem();

  // Component state gates which kinds have live tables in this database —
  // a switched-off component's kind cannot be loaded at all, so it is
  // reported as skipped-by-component (visibly, never silently).
  const { loadComponentCache } = await import(
    "../../server/services/component-cache"
  );
  const { isComponentEnabled } = await import(
    "../../server/modules/components"
  );
  await loadComponentCache();

  const { storage } = await import("../../server/storage");

  // The kind's descriptor: preview source, table, declared derived extras.
  type PreviewSource = NonNullable<
    ReturnType<typeof tokenPluginRegistry.list>[number]["metadata"]["previewEntity"]
  >;
  const descriptorForKind = new Map<
    string,
    {
      previewEntity: PreviewSource;
      columns: string[];
      extras: string[];
      requiredComponent?: string;
    }
  >();
  for (const p of tokenPluginRegistry.list()) {
    const source = p.metadata.previewEntity;
    if (!source) continue;
    const table = p.metadata.entityTable;
    descriptorForKind.set(p.metadata.outputType, {
      previewEntity: source,
      columns: table
        ? Object.values(getTableColumns(table)).map((c) => c.name)
        : [],
      extras: p.metadata.entityFields ?? [],
      requiredComponent:
        source.requiredComponent ?? p.metadata.requiredComponent,
    });
  }

  const comparedKinds = new Set<string>();
  let comparisons = 0;

  for (const plugin of eventNotifierRegistry.list()) {
    for (const root of plugin.tokenTemplates?.roots ?? []) {
      const descriptor = descriptorForKind.get(root.kind);
      if (!descriptor) continue; // kind not previewable — nothing to keep in step
      comparedKinds.add(root.kind);

      const key = `${plugin.id}:${root.name}`;
      const label = `${plugin.id} → {{${root.name}}} (${root.kind})`;

      const synthesize = PAYLOAD_SYNTHESIZERS[key];
      if (!synthesize) {
        fail(
          label,
          `no payload synthesizer for this root — add one to ` +
            `PAYLOAD_SYNTHESIZERS so the preview loader is compared against ` +
            `this builder`,
        );
        continue;
      }

      if (
        descriptor.requiredComponent &&
        !isComponentEnabled(descriptor.requiredComponent)
      ) {
        console.log(
          `SKIP: ${label} — component "${descriptor.requiredComponent}" is ` +
            `disabled in this database (its tables may not exist)`,
        );
        continue;
      }

      // A real record, exactly as the picker would offer it.
      const candidates = await descriptor.previewEntity.search(storage, "", 1);
      if (candidates.length === 0) {
        fail(
          label,
          `no ${root.kind} record in this database to compare — seed one; ` +
            `an empty kind leaves this builder unverified`,
        );
        continue;
      }
      const id = candidates[0].id;

      const loaded = await descriptor.previewEntity.load(storage, id);
      if (!loaded) {
        fail(label, `preview load returned null for record ${id} the picker offered`);
        continue;
      }

      const payload = await synthesize(storage, id);
      if (!payload) {
        fail(label, `could not synthesize an event payload from record ${id}`);
        continue;
      }
      // Builders read only ctx.payload; the rest of the event context is
      // dispatcher plumbing they never touch.
      const built = await root.build({ payload } as any);
      if (!built) {
        fail(
          label,
          `root build() returned null for record ${id} — the preview loader ` +
            `found a row the builder refuses`,
        );
        continue;
      }

      // Every field the token catalog advertises for this root: the kind's
      // columns, its descriptor's derived extras, and the root's own extras.
      const advertised = [
        ...descriptor.columns,
        ...descriptor.extras,
        ...(root.fields ?? []),
      ];
      const diffs: string[] = [];
      for (const name of advertised) {
        const previewValue = fieldValue(loaded.entity, name);
        const deliveryValue = fieldValue(built, name);
        if (previewValue !== deliveryValue) {
          diffs.push(
            `${name}: preview=${JSON.stringify(previewValue)} ` +
              `delivery=${JSON.stringify(deliveryValue)}`,
          );
        }
      }
      if (diffs.length > 0) {
        fail(
          label,
          `preview and delivery rows differ on record ${id}:\n    ` +
            diffs.join("\n    "),
        );
        continue;
      }

      comparisons++;
      console.log(`PASS: ${label} — ${advertised.length} advertised fields agree`);
    }
  }

  // Closure the other way: a previewable kind nobody compared must be a
  // deliberately recipient-only kind, never an accident.
  for (const kind of descriptorForKind.keys()) {
    if (comparedKinds.has(kind)) {
      if (RECIPIENT_ONLY_KINDS.has(kind)) {
        fail(
          kind,
          `listed in RECIPIENT_ONLY_KINDS but a notifier now seeds it as a ` +
            `root — remove the entry`,
        );
      }
      continue;
    }
    if (!RECIPIENT_ONLY_KINDS.has(kind)) {
      fail(
        kind,
        `previewable but no notifier root of this kind was compared — add a ` +
          `synthesizer for its owning root, or list it in ` +
          `RECIPIENT_ONLY_KINDS if it is genuinely recipient-only`,
      );
    }
  }
  for (const kind of RECIPIENT_ONLY_KINDS) {
    if (!descriptorForKind.has(kind)) {
      fail(kind, `RECIPIENT_ONLY_KINDS entry is not a previewable kind — remove it`);
    }
  }

  console.log(`\nCompared ${comparisons} notifier root(s) against the preview loader.`);
  console.log(failures === 0 ? "ALL CHECKS PASSED" : `${failures} FAILURES`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error("Check crashed:", err);
  process.exit(1);
});

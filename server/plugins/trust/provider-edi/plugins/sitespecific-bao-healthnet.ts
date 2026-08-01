import { and, asc, eq, inArray } from "drizzle-orm";
import {
  workers,
  contacts,
  contactPostal,
  phoneNumbers,
  optionsGender,
  trustBenefits,
  trustWmb,
  workerHours,
  workerRelations,
  optionsWorkerRelationType,
  employers,
} from "@shared/schema";
import {
  registerTrustProviderEdiPlugin,
  type TrustProviderEdiContext,
} from "../registry";

/**
 * BAO — HealthNet eligibility EDI file.
 *
 * Port of the legacy PHP generator's record encoding
 * (Sirius_Smf_Report_Edi_Healthnet). Produces a fixed-width file with one
 * record per member — the subscriber ("M") and each covered dependent
 * ("P"/"D"/"S"/"Q") get their own row in the same 54-field layout — for
 * every worker who holds a monthly benefit record (trust_wmb) for the
 * configured benefit in the as-of month.
 *
 * Fixed-width layout: `EDI_FIELDS` below defines every output field in
 * order with its exact width. A row is the concatenation of each field
 * value left-justified and space-padded to its width.
 */

/** Field layout, in output order. `get` reads from the persisted row. */
interface EdiField {
  name: string;
  width: number;
  get?: (row: Record<string, unknown>) => string;
}

// Exact port of the legacy PHP `edi_fields()` layout (field order and
// widths). Fields with no `get` emit spaces.
const EDI_FIELDS: EdiField[] = [
  { name: "Health Net Group Number", width: 6, get: (r) => str(r.groupNumber) },
  { name: "Reserved 1", width: 2 },
  { name: "File Date", width: 8, get: (r) => str(r.fileDate) },
  { name: "Transaction Type (Activity Flag)", width: 1 },
  { name: "Coverage Begin Date", width: 8, get: (r) => str(r.coverageStart) },
  { name: "Subscriber SSN", width: 9, get: (r) => str(r.subscriberSsn) },
  { name: "Dependent SSN", width: 9, get: (r) => str(r.memberSsn) },
  { name: "Member Type", width: 1, get: (r) => str(r.memberType) },
  { name: "Reserved 2", width: 3 },
  { name: "Last Name & Suffix", width: 17, get: (r) => str(r.lastName) },
  { name: "First Name", width: 10, get: (r) => str(r.firstName) },
  { name: "Middle Initial", width: 1, get: (r) => str(r.middleInitial) },
  { name: "Gender", width: 1, get: (r) => str(r.gender) },
  { name: "Date of Birth", width: 8, get: (r) => str(r.birthDate) },
  { name: "Address Line 1", width: 25, get: (r) => str(r.street) },
  { name: "Address Line 2", width: 25 },
  { name: "City", width: 17, get: (r) => str(r.city) },
  { name: "State", width: 2, get: (r) => str(r.state) },
  { name: "Zip Code", width: 5, get: (r) => str(r.zip) },
  { name: "Zip Code +4 Extension", width: 4 },
  { name: "Work Telephone", width: 10, get: (r) => str(r.phone) },
  { name: "Residence Telephone", width: 10 },
  { name: "Provider ID", width: 4 },
  { name: "Physician Last Name", width: 20 },
  { name: "Physician First Name", width: 20 },
  { name: "Physician Middle Initial", width: 1 },
  { name: "4-Digit PPG ID", width: 4 },
  { name: "6-Digit PCP ID", width: 6 },
  { name: "Current Patient Indicator", width: 1 },
  { name: "Hire Date", width: 8, get: (r) => str(r.hireDate) },
  { name: "Employee Number", width: 6 },
  { name: "Department", width: 6 },
  { name: "COBRA End Date", width: 6 },
  { name: "Pay Status Code", width: 2, get: (r) => str(r.payStatusCode) },
  { name: "Contract Type", width: 1, get: (r) => str(r.contractType) },
  { name: "Number Covered", width: 2, get: (r) => str(r.numberCovered) },
  { name: "Coverage End Date", width: 8, get: (r) => str(r.coverageEnd) },
  { name: "Foreign Address Flag", width: 1 },
  { name: "Correspondence Indicator", width: 3 },
  { name: "Ethnicity Indicator", width: 3 },
  { name: "Student Indicator", width: 1 },
  { name: "Medicare Part A Indicator", width: 1 },
  { name: "Medicare Part B Indicator", width: 1 },
  { name: "Medicare Parts A & B Indicator", width: 1 },
  { name: "Medicare Part D Indicator", width: 1 },
  { name: "Disabled Indicator", width: 1 },
  { name: "Filler 1", width: 13 },
  {
    name: "Health Insurance Claim Number (for Medicare COB)",
    width: 13,
  },
  { name: "Coordination of Benefits", width: 1 },
  { name: "Insurance Line Code", width: 3, get: () => "HMO" },
  { name: "Current Premium Amount", width: 8 },
  { name: "Retroactive Debit Amount", width: 8 },
  { name: "Retroactive Credit Amount", width: 8 },
  { name: "Record End Designator", width: 5, get: () => "HNPES" },
];

/** Encode one persisted row as a fixed-width HealthNet record (exported for the format check script). */
export function encodeHealthnetRow(row: Record<string, unknown>): string {
  return EDI_FIELDS.map((f) => padField(f.get ? f.get(row) : "", f)).join("");
}

/** Exported for the format check script. */
export const HEALTHNET_EDI_FIELDS: ReadonlyArray<{ name: string; width: number }> =
  EDI_FIELDS.map((f) => ({ name: f.name, width: f.width }));

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function padField(value: string, field: EdiField): string {
  return value.slice(0, field.width).padEnd(field.width, " ");
}

/** yyyy-mm-dd (or Date) → YYYYMMDD; empty when absent. */
function ymdCompact(value: unknown): string {
  if (!value) return "";
  const s = String(value).slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s.replace(/-/g, "") : "";
}

/** SSN digits, zero-padded to 9; empty stays empty. */
function padSsn(ssn: unknown): string {
  const digits = String(ssn ?? "").replace(/\D/g, "");
  return digits ? digits.padStart(9, "0").slice(-9) : "";
}

function phoneDigits(phone: unknown): string {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits.length === 11 && digits.startsWith("1")
    ? digits.slice(1)
    : digits.slice(0, 10);
}

/**
 * Relation-type sirius id → HealthNet member type. Legacy comment:
 * M = Self (subscriber), P = Domestic Partner, S = Spouse, Q = QMSCO,
 * D = child of any other flavor. Unknown types fall back to M like the
 * legacy generator did.
 */
export function memberType(relationSiriusId: string | null): string {
  if (!relationSiriusId) return "M";
  if (relationSiriusId === "DP") return "P";
  if (["C", "AC", "H", "SC", "G"].includes(relationSiriusId)) return "D";
  if (relationSiriusId === "SP") return "S";
  if (relationSiriusId === "QMSCO") return "Q";
  return "M";
}

/** Gender option code → HealthNet gender (F/M; unknown defaults to F like legacy). */
function genderCode(code: string | null): string {
  return code === "M" ? "M" : "F";
}

interface HealthnetConfigData {
  groupNumber?: string;
  benefitSiriusId?: string;
}

function readConfig(ctx: TrustProviderEdiContext): Required<HealthnetConfigData> {
  const d = (ctx.configData ?? {}) as HealthnetConfigData;
  return {
    groupNumber: d.groupNumber || "LB391A",
    benefitSiriusId: d.benefitSiriusId || "H",
  };
}

function readInput(ctx: TrustProviderEdiContext): {
  asOfYmd: string;
  fileDate: string;
} {
  const input = ctx.input ?? {};
  const today = new Date().toISOString().slice(0, 10);
  const asOfYmd =
    typeof input.asOfDate === "string" && input.asOfDate ? input.asOfDate : today;
  // Legacy: File Date is always the file creation date.
  return { asOfYmd, fileDate: ymdCompact(today) };
}

async function resolveBenefitId(
  ctx: TrustProviderEdiContext,
  benefitSiriusId: string,
): Promise<string | null> {
  const rows = await ctx.storage.readOnly.query(async (db) =>
    db
      .select({ id: trustBenefits.id })
      .from(trustBenefits)
      .where(eq(trustBenefits.siriusId, benefitSiriusId)),
  );
  return rows[0]?.id ?? null;
}

registerTrustProviderEdiPlugin({
  id: "sitespecific-bao-healthnet",
  name: "BAO - HealthNet Eligibility File",
  description:
    "Fixed-width HealthNet eligibility file: one record per member (subscriber " +
    "plus each covered dependent) with a HealthNet monthly benefit record in the as-of month.",
  requiredComponent: "sitespecific.bao",
  configSchema: {
    type: "object",
    properties: {
      groupNumber: {
        type: "string",
        title: "Group Number",
        default: "LB391A",
        description: "HealthNet group number placed at the start of every record.",
      },
      benefitSiriusId: {
        type: "string",
        title: "Benefit Sirius ID",
        default: "H",
        description:
          "Sirius ID of the trust benefit whose monthly benefit records populate the file.",
      },
    },
  },
  inputSchema: {
    type: "object",
    properties: {
      asOfDate: {
        type: "string",
        format: "date",
        title: "As-of Date",
        description:
          "Include workers with a monthly benefit record in this date's month (defaults to today).",
      },
    },
  },
  getColumns() {
    return [
      { id: "memberType", header: "Member Type", type: "string", width: 100 },
      { id: "subscriberName", header: "Subscriber", type: "string", width: 200 },
      { id: "memberName", header: "Member", type: "string", width: 200 },
      { id: "memberSsn", header: "SSN", type: "string", width: 100 },
      { id: "birthDate", header: "Birth Date", type: "string", width: 100 },
      { id: "gender", header: "Gender", type: "string", width: 80 },
      { id: "coverageStart", header: "Coverage Start", type: "string", width: 110 },
      { id: "payStatusCode", header: "Pay Status", type: "string", width: 90 },
      { id: "contractType", header: "Contract Type", type: "string", width: 100 },
      { id: "numberCovered", header: "Covered", type: "string", width: 80 },
      { id: "hireDate", header: "Hire Date", type: "string", width: 100 },
      { id: "city", header: "City", type: "string", width: 130 },
      { id: "state", header: "State", type: "string", width: 60 },
    ];
  },

  // NOTE on provider scoping: file membership is defined by the configured
  // benefit (benefitSiriusId) — workers with a monthly benefit record
  // (trust_wmb) for that benefit in the as-of month. The config's providerId
  // is an organizational dimension (which provider entity the file/SFTP
  // destination belongs to); the schema has no provider→benefit relation to
  // filter by. Admins must point each config at the correct benefit.
  async getPrimaryKeys(ctx) {
    const cfg = readConfig(ctx);
    const { asOfYmd } = readInput(ctx);
    const benefitId = await resolveBenefitId(ctx, cfg.benefitSiriusId);
    if (!benefitId) {
      throw new Error(
        `No trust benefit found with Sirius ID '${cfg.benefitSiriusId}' — check the EDI configuration.`,
      );
    }
    const asOfYear = Number(asOfYmd.slice(0, 4));
    const asOfMonth = Number(asOfYmd.slice(5, 7));
    const wmbRows = await ctx.storage.readOnly.query(async (db) =>
      db
        .select({
          id: trustWmb.id,
          workerId: trustWmb.workerId,
          employerSiriusId: employers.siriusId,
        })
        .from(trustWmb)
        .leftJoin(employers, eq(trustWmb.employerId, employers.id))
        .where(
          and(
            eq(trustWmb.benefitId, benefitId),
            eq(trustWmb.year, asOfYear),
            eq(trustWmb.month, asOfMonth),
          ),
        ),
    );
    // One subscriber per worker: if a worker has several qualifying rows
    // (e.g. two employers), pick deterministically — prefer a non-COBRA
    // employer row, then lowest row id.
    const byWorker = new Map<string, (typeof wmbRows)[number]>();
    for (const row of wmbRows) {
      const prev = byWorker.get(row.workerId);
      if (!prev) {
        byWorker.set(row.workerId, row);
        continue;
      }
      const prevCobra = prev.employerSiriusId === "COBRA";
      const rowCobra = row.employerSiriusId === "COBRA";
      if (
        (prevCobra && !rowCobra) ||
        (prevCobra === rowCobra && row.id < prev.id)
      ) {
        byWorker.set(row.workerId, row);
      }
    }
    return Array.from(byWorker.values()).map((r) => r.id);
  },

  async processBatch(keys, ctx) {
    const cfg = readConfig(ctx);
    const { asOfYmd, fileDate } = readInput(ctx);

    const rows = await ctx.storage.readOnly.query(async (db) => {
      const wmbRows = await db
        .select()
        .from(trustWmb)
        .where(inArray(trustWmb.id, keys));

      const out: Array<Record<string, unknown>> = [];

      // COBRA members (pay status "CO") are those whose monthly benefit
      // record's employer has the Sirius ID "COBRA".
      const employerIds = Array.from(
        new Set(wmbRows.map((e) => e.employerId).filter(Boolean)),
      );
      const cobraEmployers = employerIds.length
        ? await db
            .select({ id: employers.id })
            .from(employers)
            .where(
              and(
                inArray(employers.id, employerIds),
                eq(employers.siriusId, "COBRA"),
              ),
            )
        : [];
      const cobraEmployerIds = new Set(cobraEmployers.map((e) => e.id));

      // Coverage start = first month of the worker's CONTIGUOUS run of
      // monthly records for this benefit ending at the as-of month.
      const workerIds = Array.from(new Set(wmbRows.map((r) => r.workerId)));
      const benefitIds = Array.from(new Set(wmbRows.map((r) => r.benefitId)));
      const allMonths = workerIds.length
        ? await db
            .select({
              workerId: trustWmb.workerId,
              year: trustWmb.year,
              month: trustWmb.month,
            })
            .from(trustWmb)
            .where(
              and(
                inArray(trustWmb.workerId, workerIds),
                inArray(trustWmb.benefitId, benefitIds),
              ),
            )
        : [];
      const monthsByWorker = new Map<string, Set<string>>();
      for (const m of allMonths) {
        let set = monthsByWorker.get(m.workerId);
        if (!set) monthsByWorker.set(m.workerId, (set = new Set()));
        set.add(`${m.year}-${m.month}`);
      }
      /** Walk back from (year, month) while the previous month exists. */
      function coverageStartFor(workerId: string, year: number, month: number): string {
        const set = monthsByWorker.get(workerId);
        let y = year;
        let m = month;
        while (set) {
          let py = y;
          let pm = m - 1;
          if (pm === 0) {
            pm = 12;
            py -= 1;
          }
          if (!set.has(`${py}-${pm}`)) break;
          y = py;
          m = pm;
        }
        return `${String(y).padStart(4, "0")}-${String(m).padStart(2, "0")}-01`;
      }

      for (const wmb of wmbRows) {
        // Subscriber demographics.
        const [subscriber] = await db
          .select({
            workerId: workers.id,
            ssn: workers.ssn,
            contactId: contacts.id,
            givenName: contacts.given,
            familyName: contacts.family,
            middleName: contacts.middle,
            birthDate: contacts.birthDate,
            genderCode: optionsGender.code,
          })
          .from(workers)
          .innerJoin(contacts, eq(workers.contactId, contacts.id))
          .leftJoin(optionsGender, eq(contacts.gender, optionsGender.id))
          .where(eq(workers.id, wmb.workerId));
        if (!subscriber) continue;

        const [postal] = await db
          .select({
            street: contactPostal.street,
            city: contactPostal.city,
            state: contactPostal.state,
            postalCode: contactPostal.postalCode,
          })
          .from(contactPostal)
          .where(
            and(
              eq(contactPostal.contactId, subscriber.contactId),
              eq(contactPostal.isActive, true),
              eq(contactPostal.isPrimary, true),
            ),
          );
        const [phone] = await db
          .select({ phoneNumber: phoneNumbers.phoneNumber })
          .from(phoneNumbers)
          .where(
            and(
              eq(phoneNumbers.contactId, subscriber.contactId),
              eq(phoneNumbers.isActive, true),
              eq(phoneNumbers.isPrimary, true),
            ),
          );

        // Covered dependents: the worker's relations still active as of the
        // run date (monthly benefit records carry no relationship list).
        const relations = await db
          .select({
            relationId: workerRelations.id,
            relationSiriusId: optionsWorkerRelationType.siriusId,
            startYmd: workerRelations.startYmd,
            endYmd: workerRelations.endYmd,
            ssn: workers.ssn,
            contactId: contacts.id,
            givenName: contacts.given,
            familyName: contacts.family,
            middleName: contacts.middle,
            birthDate: contacts.birthDate,
            genderCode: optionsGender.code,
          })
          .from(workerRelations)
          .innerJoin(workers, eq(workerRelations.worker2, workers.id))
          .innerJoin(contacts, eq(workers.contactId, contacts.id))
          .leftJoin(optionsGender, eq(contacts.gender, optionsGender.id))
          .innerJoin(
            optionsWorkerRelationType,
            eq(workerRelations.relationType, optionsWorkerRelationType.id),
          )
          .where(eq(workerRelations.worker1, wmb.workerId));
        // Canonical active-relation semantics: start on/before the as-of
        // date AND (no end OR end on/after the as-of date). Rows without a
        // start date are not active.
        const activeRelations = relations.filter(
          (rel) =>
            rel.startYmd &&
            rel.startYmd <= asOfYmd &&
            !(rel.endYmd && rel.endYmd < asOfYmd),
        );

        const subscriberSsn = padSsn(subscriber.ssn);
        const subscriberName = [subscriber.givenName, subscriber.familyName]
          .filter(Boolean)
          .join(" ");
        const coverageStartYmd = coverageStartFor(wmb.workerId, wmb.year, wmb.month);
        const coverageStart = ymdCompact(coverageStartYmd);
        // Monthly benefit records have no end date; coverage is open (blank).
        const coverageEnd = "";

        // Hire date (subscriber only, requires an employer on the record):
        // legacy takes the MIN of the as-of date, the worker's first hours
        // month, and the coverage begin/end dates.
        let hireDate = "";
        if (wmb.employerId) {
          const candidates = [asOfYmd, coverageStartYmd];
          const [firstHours] = await db
            .select({ year: workerHours.year, month: workerHours.month })
            .from(workerHours)
            .where(eq(workerHours.workerId, wmb.workerId))
            .orderBy(asc(workerHours.year), asc(workerHours.month))
            .limit(1);
          if (firstHours) {
            candidates.push(
              `${String(firstHours.year).padStart(4, "0")}-${String(firstHours.month).padStart(2, "0")}-01`,
            );
          }
          candidates.sort();
          hireDate = ymdCompact(candidates[0]);
        }

        const contractType =
          activeRelations.length === 0 ? "1" : activeRelations.length === 1 ? "2" : "3";
        const numberCovered = String(activeRelations.length + 1);
        const payStatusCode = cobraEmployerIds.has(wmb.employerId) ? "CO" : "AC";

        const shared = {
          groupNumber: cfg.groupNumber,
          fileDate,
          subscriberSsn,
          subscriberName,
          coverageStart,
          coverageEnd,
        };

        // Subscriber record ("M").
        out.push({
          pk: wmb.id,
          ...shared,
          memberType: "M",
          memberSsn: subscriberSsn,
          memberName: subscriberName,
          lastName: subscriber.familyName ?? "",
          firstName: subscriber.givenName ?? "",
          middleInitial: (subscriber.middleName ?? "").slice(0, 1),
          gender: genderCode(subscriber.genderCode),
          birthDate: ymdCompact(subscriber.birthDate),
          street: postal?.street ?? "",
          city: postal?.city ?? "",
          state: postal?.state ?? "",
          zip: String(postal?.postalCode ?? "").replace(/\D/g, "").slice(0, 5),
          phone: phoneDigits(phone?.phoneNumber),
          hireDate,
          payStatusCode,
          contractType,
          numberCovered,
        });

        // Dependent records — same layout; subscriber-only fields blank.
        for (const rel of activeRelations) {
          // Dependents carry their own address (legacy reads the member's
          // record); phone/hire/pay-status/contract/covered are blank.
          const [relPostal] = await db
            .select({
              street: contactPostal.street,
              city: contactPostal.city,
              state: contactPostal.state,
              postalCode: contactPostal.postalCode,
            })
            .from(contactPostal)
            .where(
              and(
                eq(contactPostal.contactId, rel.contactId),
                eq(contactPostal.isActive, true),
                eq(contactPostal.isPrimary, true),
              ),
            );

          out.push({
            pk: `${wmb.id}:${rel.relationId}`,
            ...shared,
            memberType: memberType(rel.relationSiriusId ?? null),
            memberSsn: padSsn(rel.ssn),
            memberName: [rel.givenName, rel.familyName].filter(Boolean).join(" "),
            lastName: rel.familyName ?? "",
            firstName: rel.givenName ?? "",
            middleInitial: (rel.middleName ?? "").slice(0, 1),
            gender: genderCode(rel.genderCode),
            birthDate: ymdCompact(rel.birthDate),
            street: relPostal?.street ?? "",
            city: relPostal?.city ?? "",
            state: relPostal?.state ?? "",
            zip: String(relPostal?.postalCode ?? "").replace(/\D/g, "").slice(0, 5),
            phone: "",
            hireDate: "",
            payStatusCode: "",
            contractType: "",
            numberCovered: "",
          });
        }
      }
      return out;
    });

    return rows;
  },

  encodeRow(row) {
    return encodeHealthnetRow(row);
  },

  buildFilename() {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `HEALTHNET_${stamp}.txt`;
  },
});

import { and, eq, inArray } from "drizzle-orm";
import {
  workers,
  contacts,
  contactPostal,
  phoneNumbers,
  optionsGender,
  trustBenefits,
  trustWmb,
  workerRelations,
  optionsWorkerRelationType,
  employers,
} from "@shared/schema";
import {
  registerTrustProviderEdiPlugin,
  type TrustProviderEdiContext,
} from "../registry";

/**
 * BAO — Kaiser Permanente eligibility EDI file.
 *
 * Port of the legacy PHP generator's record encoding. Produces a
 * fixed-width file with one record per subscriber ("A" record) and one per
 * covered dependent ("D" record) for every worker who holds a monthly
 * benefit record (trust_wmb) for the configured benefit in the as-of month.
 *
 * Fixed-width layout: `EDI_FIELDS` below defines every output field in
 * order with its exact width (FILLER fields emit spaces). A row is the
 * concatenation of each field value left-justified and space-padded (or
 * zero-padded where noted) to its width.
 */

/** Field layout, in output order. `get` reads from the persisted row. */
interface EdiField {
  name: string;
  width: number;
  /** 'left' (default, space pad) | 'right' (zero pad, numeric). */
  align?: "left" | "right";
  get?: (row: Record<string, unknown>) => string;
}

// Exact port of the legacy PHP `edi_fields()` layout (field order, widths,
// and FILLERs). Fields with no `get` emit spaces.
const EDI_FIELDS: EdiField[] = [
  { name: "Region Code", width: 3, get: (r) => str(r.regionCode) },
  { name: "Record Type", width: 1, get: () => "1" },
  { name: "Customer ID", width: 9, get: (r) => str(r.customerId) },
  { name: "Enrollment Unit", width: 4, get: (r) => str(r.enrollmentUnit) },
  { name: "FILLER1", width: 36 },
  { name: "Activity Date", width: 8, get: (r) => str(r.activityDate) },
  { name: "Transaction Type", width: 1 },
  { name: "Record Code", width: 1, get: (r) => str(r.recordCode) },
  { name: "FILLER2", width: 38 },
  { name: "Last Name", width: 25, get: (r) => str(r.lastName) },
  { name: "First Name", width: 25, get: (r) => str(r.firstName) },
  { name: "Middle Name", width: 25, get: (r) => str(r.middleName) },
  { name: "Account Role", width: 2, get: (r) => str(r.accountRole) },
  { name: "FILLER3", width: 10 },
  { name: "Birth Date", width: 8, get: (r) => str(r.birthDate) },
  { name: "Marital Status", width: 2 },
  { name: "FILLER4", width: 10 },
  { name: "Gender", width: 2, get: (r) => str(r.gender) },
  { name: "FILLER5", width: 5 },
  { name: "FILLER6", width: 1 },
  { name: "FILLER7", width: 2 },
  { name: "Subscriber SSN", width: 9, get: (r) => str(r.subscriberSsn) },
  { name: "Member SSN", width: 9, get: (r) => str(r.memberSsn) },
  { name: "FILLER8", width: 2 },
  { name: "Employee ID", width: 9 },
  { name: "Supplemental ID", width: 16, get: (r) => str(r.supplementalId) },
  { name: "Employer ID", width: 4 },
  { name: "Employment Status", width: 2 },
  { name: "FILLER9", width: 5 },
  { name: "Hire Date", width: 8 },
  { name: "Home Phone", width: 10, get: (r) => str(r.phone) },
  { name: "Work", width: 10 },
  { name: "FILLER10", width: 30 },
  { name: "Address Line 1", width: 40, get: (r) => str(r.street) },
  { name: "Address Line 2", width: 40 },
  { name: "FILLER11", width: 30 },
  { name: "City", width: 45, get: (r) => str(r.city) },
  { name: "FILLER12", width: 45 },
  { name: "State", width: 2, get: (r) => str(r.state) },
  { name: "ZIP Code", width: 5, get: (r) => str(r.zip) },
  { name: "FILLER13", width: 2 },
  { name: "ZIP Plus 4", width: 4 },
  { name: "FILLER14", width: 45 },
  { name: "Enrollment  Reason", width: 2 },
  { name: "FILLER15", width: 10 },
  { name: "Effective Date", width: 8, get: (r) => str(r.coverageStart) },
  { name: "FILLER16", width: 8 },
  { name: "FILLER17", width: 2 },
  { name: "FILLER18", width: 10 },
  { name: "Termination Date", width: 8, get: (r) => str(r.coverageEnd) },
  { name: "FILLER19", width: 2 },
  { name: "FILLER20", width: 8 },
  { name: "Current Eligibility Status", width: 1 },
  { name: "Current Dues Amount", width: 7, get: (r) => str(r.duesAmount) },
  { name: "Current Rate Code", width: 5 },
  { name: "Retroactivity Date", width: 8 },
  { name: "Retroactive Dues Amount", width: 7 },
  { name: "Retroactive Rate Code", width: 5 },
  { name: "Additional Retroactivity", width: 220 },
  { name: "FILLER21", width: 7 },
  { name: "Eligibility Date", width: 8 },
  { name: "Dues Amount or Rate Code", width: 7 },
  { name: "Eligibility Status", width: 1 },
  { name: "Additional Eligibility Grid Information", width: 160 },
  { name: "FILLER22", width: 36 },
];

/** Encode one persisted row as a fixed-width Kaiser record (exported for the format check script). */
export function encodeKaiserRow(row: Record<string, unknown>): string {
  return EDI_FIELDS.map((f) => padField(f.get ? f.get(row) : "", f)).join("");
}

/** Exported for the format check script. */
export const KAISER_EDI_FIELDS: ReadonlyArray<{ name: string; width: number }> =
  EDI_FIELDS.map((f) => ({ name: f.name, width: f.width }));

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function padField(value: string, field: EdiField): string {
  const v = value.slice(0, field.width);
  return field.align === "right"
    ? v.padStart(field.width, "0")
    : v.padEnd(field.width, " ");
}

/**
 * Legacy `kaiser_encode_number`: amount in dollars → cents with the last
 * digit replaced by a signed-overpunch character, zero-padded to 7 wide.
 * kaiserEncodeNumber(0) === "000000{".
 */
export function kaiserEncodeNumber(amount: number, width = 7): string {
  const cents = Math.round(Math.abs(amount) * 100);
  const digits = String(cents).padStart(width, "0").slice(-width);
  const lastDigit = Number(digits[digits.length - 1]);
  const positives = ["{", "A", "B", "C", "D", "E", "F", "G", "H", "I"];
  const negatives = ["}", "J", "K", "L", "M", "N", "O", "P", "Q", "R"];
  const overpunch = amount < 0 ? negatives[lastDigit] : positives[lastDigit];
  return digits.slice(0, -1) + overpunch;
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

/** Relation-type sirius id → Kaiser account role. */
function accountRole(relationSiriusId: string | null): string {
  if (!relationSiriusId) return "01";
  if (relationSiriusId === "DP") return "05";
  if (["C", "AC", "H", "QMSCO", "SC", "G"].includes(relationSiriusId)) return "06";
  if (relationSiriusId === "SP") return "07";
  return "01";
}

/** Gender option code → Kaiser gender code (01 male / 02 female / 03 other). */
function genderCode(code: string | null): string {
  if (code === "M") return "01";
  if (code === "F") return "02";
  return "03";
}

/** Coverage start is floored at the Kaiser go-live date. */
const COVERAGE_START_FLOOR = "2025-08-01";

interface KaiserConfigData {
  regionCode?: string;
  customerId?: string;
  benefitSiriusId?: string;
}

function readConfig(ctx: TrustProviderEdiContext): Required<KaiserConfigData> {
  const d = (ctx.configData ?? {}) as KaiserConfigData;
  return {
    regionCode: d.regionCode || "SCR",
    customerId: d.customerId || "000226111",
    benefitSiriusId: d.benefitSiriusId || "K",
  };
}

function readInput(ctx: TrustProviderEdiContext): {
  asOfYmd: string;
  activityDate: string;
} {
  const input = ctx.input ?? {};
  const today = new Date().toISOString().slice(0, 10);
  const asOfYmd = typeof input.asOfDate === "string" && input.asOfDate ? input.asOfDate : today;
  // activity_date option: file creation date (default) vs first of the
  // current month (legacy uses today's month, not the as-of month).
  const mode = input.activityDateMode === "first_of_month" ? "first_of_month" : "creation_date";
  const activity = mode === "first_of_month" ? `${today.slice(0, 7)}-01` : today;
  return { asOfYmd, activityDate: ymdCompact(activity) };
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
  id: "sitespecific-bao-kaiser",
  name: "BAO - Kaiser Eligibility File",
  description:
    "Fixed-width Kaiser Permanente eligibility file: one record per subscriber " +
    "with a Kaiser monthly benefit record in the as-of month, plus one per covered dependent.",
  requiredComponent: "sitespecific.bao",
  configSchema: {
    type: "object",
    properties: {
      regionCode: {
        type: "string",
        title: "Region Code",
        default: "SCR",
        description: "Kaiser region code placed at the start of every record.",
      },
      customerId: {
        type: "string",
        title: "Customer ID",
        default: "000226111",
        description: "Kaiser customer/group number (9 digits).",
      },
      benefitSiriusId: {
        type: "string",
        title: "Benefit Sirius ID",
        default: "K",
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
      activityDateMode: {
        type: "string",
        title: "Activity Date",
        enum: ["creation_date", "first_of_month"],
        default: "creation_date",
        description:
          "Whether records carry the file creation date or the first of the as-of month.",
      },
    },
  },
  getColumns() {
    return [
      { id: "recordCode", header: "Record", type: "string", width: 80 },
      { id: "subscriberName", header: "Subscriber", type: "string", width: 200 },
      { id: "memberName", header: "Member", type: "string", width: 200 },
      { id: "accountRole", header: "Role", type: "string", width: 70 },
      { id: "memberSsn", header: "SSN", type: "string", width: 100 },
      { id: "birthDate", header: "Birth Date", type: "string", width: 100 },
      { id: "gender", header: "Gender", type: "string", width: 80 },
      { id: "coverageStart", header: "Coverage Start", type: "string", width: 110 },
      { id: "coverageEnd", header: "Coverage End", type: "string", width: 110 },
      { id: "enrollmentUnit", header: "Enrollment Unit", type: "string", width: 110 },
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
    // One subscriber record per worker: if a worker has several qualifying
    // rows (e.g. two employers), pick deterministically — prefer a non-COBRA
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
    const { asOfYmd, activityDate } = readInput(ctx);

    const rows = await ctx.storage.readOnly.query(async (db) => {
      const wmbRows = await db
        .select()
        .from(trustWmb)
        .where(inArray(trustWmb.id, keys));

      const out: Array<Record<string, unknown>> = [];

      // COBRA members (Kaiser enrollment unit 7000) are those whose monthly
      // benefit record's employer has the Sirius ID "COBRA".
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
      // monthly records for this benefit ending at the as-of month. Load all
      // (worker, year, month) pairs for the batch's workers + benefit once.
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

        const subscriberSsn = padSsn(subscriber.ssn);
        const subscriberName = [subscriber.givenName, subscriber.familyName]
          .filter(Boolean)
          .join(" ");
        const startYmd = coverageStartFor(wmb.workerId, wmb.year, wmb.month);
        const coverageStartYmd =
          startYmd < COVERAGE_START_FLOOR ? COVERAGE_START_FLOOR : startYmd;

        const shared = {
          regionCode: cfg.regionCode,
          customerId: cfg.customerId,
          enrollmentUnit: cobraEmployerIds.has(wmb.employerId)
            ? "7000"
            : "0000",
          activityDate,
          subscriberSsn,
          subscriberName,
          coverageStart: ymdCompact(coverageStartYmd),
          // Monthly benefit records have no end date; coverage is open,
          // matching how an election with null endYmd encoded (blank).
          coverageEnd: "",
          // Premiums are not modeled here yet; the legacy generator encodes
          // the (zero) amount, producing "000000{".
          duesAmount: kaiserEncodeNumber(0),
        };

        // Subscriber record ("A").
        out.push({
          pk: wmb.id,
          ...shared,
          recordCode: "A",
          memberSsn: subscriberSsn,
          memberName: subscriberName,
          accountRole: "01",
          lastName: subscriber.familyName ?? "",
          firstName: subscriber.givenName ?? "",
          middleName: subscriber.middleName ?? "",
          gender: genderCode(subscriber.genderCode),
          birthDate: ymdCompact(subscriber.birthDate),
          street: postal?.street ?? "",
          city: postal?.city ?? "",
          state: postal?.state ?? "",
          zip: String(postal?.postalCode ?? "").replace(/\D/g, "").slice(0, 5),
          phone: phoneDigits(phone?.phoneNumber),
          supplementalId: "",
        });

        // Dependent records ("D"): the worker's covered relations that are
        // still active as of the run date (monthly benefit records carry no
        // explicit relationship list, unlike elections).
        const relations = await db
          .select({
            relationId: workerRelations.id,
            relationSiriusId: optionsWorkerRelationType.siriusId,
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

        for (const rel of relations) {
          if (rel.endYmd && rel.endYmd < asOfYmd) continue;
          const relSirius = rel.relationSiriusId ?? null;

          // Dependents carry their own address and phone (legacy generator
          // reads them from the member's record, not the subscriber's).
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
          const [relPhone] = await db
            .select({ phoneNumber: phoneNumbers.phoneNumber })
            .from(phoneNumbers)
            .where(
              and(
                eq(phoneNumbers.contactId, rel.contactId),
                eq(phoneNumbers.isActive, true),
                eq(phoneNumbers.isPrimary, true),
              ),
            );

          out.push({
            pk: `${wmb.id}:${rel.relationId}`,
            ...shared,
            recordCode: "D",
            memberSsn: padSsn(rel.ssn),
            memberName: [rel.givenName, rel.familyName].filter(Boolean).join(" "),
            accountRole: accountRole(relSirius),
            lastName: rel.familyName ?? "",
            firstName: rel.givenName ?? "",
            middleName: rel.middleName ?? "",
            gender: genderCode(rel.genderCode),
            birthDate: ymdCompact(rel.birthDate),
            street: relPostal?.street ?? "",
            city: relPostal?.city ?? "",
            state: relPostal?.state ?? "",
            zip: String(relPostal?.postalCode ?? "").replace(/\D/g, "").slice(0, 5),
            phone: phoneDigits(relPhone?.phoneNumber),
            supplementalId: relSirius === "QMSCO" ? "08" : "",
          });
        }
      }
      return out;
    });

    return rows;
  },

  encodeRow(row) {
    return encodeKaiserRow(row);
  },

  buildFilename() {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `KAISER_${stamp}.txt`;
  },
});

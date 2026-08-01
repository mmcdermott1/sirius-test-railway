import { and, eq, inArray, isNull, lte, or, gte, arrayContains } from "drizzle-orm";
import {
  workers,
  contacts,
  contactPostal,
  phoneNumbers,
  optionsGender,
  trustBenefits,
  workerTrustElections,
  workerRelations,
  optionsWorkerRelationType,
} from "@shared/schema";
import {
  registerTrustProviderEdiPlugin,
  type TrustProviderEdiContext,
} from "../registry";

/**
 * BAO — Kaiser Permanente eligibility EDI file.
 *
 * Port of the legacy PHP generator. Produces a fixed-width file with one
 * record per subscriber ("A" record) and one per covered dependent
 * ("D" record) for every worker holding an active trust election that
 * includes the Kaiser benefit as of the run date.
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

const EDI_FIELDS: EdiField[] = [
  { name: "region_code", width: 3, get: (r) => str(r.regionCode) },
  { name: "record_type", width: 1, get: () => "1" },
  { name: "customer_id", width: 9, get: (r) => str(r.customerId) },
  { name: "enrollment_unit", width: 4, get: (r) => str(r.enrollmentUnit) },
  { name: "activity_date", width: 8, get: (r) => str(r.activityDate) },
  { name: "record_code", width: 1, get: (r) => str(r.recordCode) },
  { name: "subscriber_ssn", width: 9, get: (r) => str(r.subscriberSsn) },
  { name: "member_ssn", width: 9, get: (r) => str(r.memberSsn) },
  { name: "account_role", width: 2, get: (r) => str(r.accountRole) },
  { name: "last_name", width: 25, get: (r) => str(r.lastName) },
  { name: "first_name", width: 15, get: (r) => str(r.firstName) },
  { name: "middle_initial", width: 1, get: (r) => str(r.middleInitial) },
  { name: "gender", width: 2, get: (r) => str(r.gender) },
  { name: "birth_date", width: 8, get: (r) => str(r.birthDate) },
  { name: "address_1", width: 30, get: (r) => str(r.street) },
  { name: "address_2", width: 30, get: () => "" },
  { name: "city", width: 20, get: (r) => str(r.city) },
  { name: "state", width: 2, get: (r) => str(r.state) },
  { name: "zip", width: 9, get: (r) => str(r.zip) },
  { name: "phone", width: 10, get: (r) => str(r.phone) },
  { name: "coverage_start", width: 8, get: (r) => str(r.coverageStart) },
  { name: "coverage_end", width: 8, get: (r) => str(r.coverageEnd) },
  { name: "supplemental_id", width: 2, get: (r) => str(r.supplementalId) },
  { name: "current_dues_amount", width: 7, get: (r) => str(r.duesAmount) },
  { name: "filler", width: 20 },
];

function str(v: unknown): string {
  return v == null ? "" : String(v);
}

function padField(value: string, field: EdiField): string {
  const v = value.slice(0, field.width);
  return field.align === "right"
    ? v.padStart(field.width, "0")
    : v.padEnd(field.width, " ");
}

/** Legacy `kaiser_encode_number`: signed-overpunch encoding, 7 chars wide. */
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
  // activity_date option: file creation date (default) vs first of the month.
  const mode = input.activityDateMode === "first_of_month" ? "first_of_month" : "creation_date";
  const activity = mode === "first_of_month" ? `${asOfYmd.slice(0, 7)}-01` : today;
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
    "with an active Kaiser trust election, plus one per covered dependent.",
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
          "Sirius ID of the trust benefit whose active elections populate the file.",
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
        description: "Include elections active on this date (defaults to today).",
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

  async getPrimaryKeys(ctx) {
    const cfg = readConfig(ctx);
    const { asOfYmd } = readInput(ctx);
    const benefitId = await resolveBenefitId(ctx, cfg.benefitSiriusId);
    if (!benefitId) {
      throw new Error(
        `No trust benefit found with Sirius ID '${cfg.benefitSiriusId}' — check the EDI configuration.`,
      );
    }
    const elections = await ctx.storage.readOnly.query(async (db) =>
      db
        .select({ id: workerTrustElections.id })
        .from(workerTrustElections)
        .where(
          and(
            arrayContains(workerTrustElections.benefitIds, [benefitId]),
            lte(workerTrustElections.startYmd, asOfYmd),
            or(
              isNull(workerTrustElections.endYmd),
              gte(workerTrustElections.endYmd, asOfYmd),
            ),
          ),
        ),
    );
    return elections.map((e) => e.id);
  },

  async processBatch(keys, ctx) {
    const cfg = readConfig(ctx);
    const { asOfYmd, activityDate } = readInput(ctx);

    const rows = await ctx.storage.readOnly.query(async (db) => {
      const elections = await db
        .select()
        .from(workerTrustElections)
        .where(inArray(workerTrustElections.id, keys));

      const out: Array<Record<string, unknown>> = [];

      for (const election of elections) {
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
          .where(eq(workers.id, election.workerId));
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
        const coverageStartYmd =
          election.startYmd < COVERAGE_START_FLOOR
            ? COVERAGE_START_FLOOR
            : election.startYmd;

        const shared = {
          regionCode: cfg.regionCode,
          customerId: cfg.customerId,
          // COBRA enrollments (unit 7000) are not modeled in this system yet;
          // all records are emitted as active-employee unit 0000.
          enrollmentUnit: "0000",
          activityDate,
          subscriberSsn,
          subscriberName,
          street: postal?.street ?? "",
          city: postal?.city ?? "",
          state: postal?.state ?? "",
          zip: String(postal?.postalCode ?? "").replace(/\D/g, "").slice(0, 9),
          phone: phoneDigits(phone?.phoneNumber),
          coverageStart: ymdCompact(coverageStartYmd),
          coverageEnd: ymdCompact(election.endYmd),
          duesAmount: "",
        };

        // Subscriber record ("A").
        out.push({
          pk: election.id,
          ...shared,
          recordCode: "A",
          memberSsn: subscriberSsn,
          memberName: subscriberName,
          accountRole: "01",
          lastName: subscriber.familyName ?? "",
          firstName: subscriber.givenName ?? "",
          middleInitial: (subscriber.middleName ?? "").slice(0, 1),
          gender: genderCode(subscriber.genderCode),
          birthDate: ymdCompact(subscriber.birthDate),
          supplementalId: "",
        });

        // Dependent records ("D") for each covered relationship.
        const relIds = election.relationshipIds ?? [];
        if (!relIds.length) continue;
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
          .where(inArray(workerRelations.id, relIds));

        for (const rel of relations) {
          if (rel.endYmd && rel.endYmd < asOfYmd) continue;
          const relSirius = rel.relationSiriusId ?? null;
          out.push({
            pk: `${election.id}:${rel.relationId}`,
            ...shared,
            recordCode: "D",
            memberSsn: padSsn(rel.ssn),
            memberName: [rel.givenName, rel.familyName].filter(Boolean).join(" "),
            accountRole: accountRole(relSirius),
            lastName: rel.familyName ?? "",
            firstName: rel.givenName ?? "",
            middleInitial: (rel.middleName ?? "").slice(0, 1),
            gender: genderCode(rel.genderCode),
            birthDate: ymdCompact(rel.birthDate),
            supplementalId: relSirius === "QMSCO" ? "08" : "",
          });
        }
      }
      return out;
    });

    return rows;
  },

  encodeRow(row) {
    return EDI_FIELDS.map((f) => padField(f.get ? f.get(row) : "", f)).join("");
  },

  buildFilename() {
    const stamp = new Date().toISOString().slice(0, 10).replace(/-/g, "");
    return `KAISER_${stamp}.txt`;
  },
});

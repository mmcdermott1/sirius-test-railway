import type { Express, Request, Response } from "express";
import { storage } from "../../storage";
import { requireComponent } from "../components";
import { addDaysYmd, getTodayYmd } from "@shared/utils/date";
import type { AssignmentForWorker } from "../../storage/edls/assignments";

/**
 * Sheet statuses a worker may see on the public schedule page. Draft/request
 * sheets are still being built and `trash` sheets are cancelled, so none of
 * them are anybody's schedule yet.
 */
const PUBLIC_SHEET_STATUSES = ["lock", "reserved"];

/** Number of calendar days shown, counting today. */
const SCHEDULE_DAYS = 7;

const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export interface PublicWorkerSchedule {
  workerName: string;
  startYmd: string;
  endYmd: string;
  assignments: AssignmentForWorker[];
}

/** Family-name-first display, e.g. "Banales, Gabriel". */
function formatWorkerName(
  contact: { given: string | null; family: string | null; displayName: string } | undefined,
): string {
  if (!contact) return "";
  if (contact.family && contact.given) return `${contact.family}, ${contact.given}`;
  return contact.family || contact.given || contact.displayName || "";
}

/**
 * Resolve the `:id` in the URL to the worker whose schedule it addresses.
 *
 * The id is a WORKER id. That is the whole address: it names the person the
 * page is about, it never changes, and it keeps working when the worker is
 * moved between crews or taken off a sheet altogether — none of which is true
 * of an assignment row.
 *
 * LEGACY: links texted before that change carry an `edls_assignments` id
 * instead, and a text cannot be recalled, so an id that is not a worker is
 * tried as an assignment and resolved to ITS worker. The two are separate id
 * spaces, so trying one then the other is unambiguous. Every such link points
 * at a sheet in the week it was sent for, so this fallback stops being able to
 * help anyone a week after the last pre-change text went out; delete it — and
 * this comment — at the next cleanup after that.
 */
async function resolveScheduleWorkerId(id: string): Promise<string | null> {
  const worker = await storage.workers.getWorker(id);
  if (worker) return worker.id;
  const assignment = await storage.edlsAssignments.get(id);
  return assignment?.workerId ?? null;
}

/**
 * Public (unauthenticated) EDLS worker schedule.
 *
 * Knowing the worker's id IS the credential: anyone holding the link sees
 * that worker's next seven days. Every rejection — malformed id, unknown id,
 * worker with no EDLS presence, contact gone — answers with the same generic
 * access-denied body so the endpoint never confirms whether a given id
 * exists.
 *
 * A worker id is not a secret — it appears in staff URLs and exports — so
 * having one is not on its own enough: the worker must have EDLS presence.
 * That refuses an id lifted from an unrelated screen (which would otherwise
 * answer with that person's name), while leaving a worker who has merely been
 * taken off a sheet able to read their own week.
 */
export function registerEdlsPublicScheduleRoutes(app: Express) {
  const edlsComponent = requireComponent("edls");

  app.get(
    "/api/public/edls/schedule/:id",
    edlsComponent,
    async (req: Request, res: Response) => {
      const denied = () => res.status(403).json({ message: "Access denied" });

      try {
        const { id } = req.params;
        if (!UUID_REGEX.test(id)) {
          denied();
          return;
        }

        const workerId = await resolveScheduleWorkerId(id);
        if (!workerId) {
          denied();
          return;
        }

        if (!(await storage.workerEdls.hasEdlsPresence(workerId))) {
          denied();
          return;
        }

        const worker = await storage.workers.getWorker(workerId);
        if (!worker) {
          denied();
          return;
        }
        const contact = await storage.contacts.getContact(worker.contactId);

        const startYmd = getTodayYmd();
        const endYmd = addDaysYmd(startYmd, SCHEDULE_DAYS - 1);

        const assignments = await storage.edlsAssignments.getAssignmentsForWorker(
          workerId,
          { startYmd, endYmd, sheetStatuses: PUBLIC_SHEET_STATUSES },
        );

        const payload: PublicWorkerSchedule = {
          workerName: formatWorkerName(contact),
          startYmd,
          endYmd,
          assignments,
        };
        res.json(payload);
      } catch (error) {
        console.error("Failed to fetch public EDLS schedule:", error);
        res.status(500).json({ message: "Failed to fetch schedule" });
      }
    },
  );
}

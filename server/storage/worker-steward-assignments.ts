import { db } from "../db";
import { workerStewardAssignments, employers, bargainingUnits, type WorkerStewardAssignment, type InsertWorkerStewardAssignment } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface WorkerStewardAssignmentWithDetails extends WorkerStewardAssignment {
  employer?: { id: string; name: string };
  bargainingUnit?: { id: string; name: string };
}

export interface StewardByEmployerDetails {
  id: string;
  workerId: string;
  employerId: string;
  bargainingUnitId: string;
  worker: {
    id: string;
    contactId: string;
  };
  bargainingUnit: {
    id: string;
    name: string;
  };
  contact: {
    id: string;
    displayName: string;
    email: string | null;
    primaryPhoneNumber: string | null;
  };
}

export interface WorkerStewardAssignmentStorage {
  getAssignmentsByWorkerId(workerId: string): Promise<WorkerStewardAssignmentWithDetails[]>;
  getAssignmentsByEmployerId(employerId: string): Promise<WorkerStewardAssignment[]>;
  getAssignmentById(id: string): Promise<WorkerStewardAssignment | undefined>;
  createAssignment(data: InsertWorkerStewardAssignment): Promise<WorkerStewardAssignment>;
  updateAssignment(id: string, data: Partial<InsertWorkerStewardAssignment>): Promise<WorkerStewardAssignment | undefined>;
  deleteAssignment(id: string): Promise<boolean>;
  findExistingAssignment(workerId: string, employerId: string, bargainingUnitId: string): Promise<WorkerStewardAssignment | undefined>;
}

export function createWorkerStewardAssignmentStorage(): WorkerStewardAssignmentStorage {
  const storage: WorkerStewardAssignmentStorage = {
    async getAssignmentsByWorkerId(workerId: string): Promise<WorkerStewardAssignmentWithDetails[]> {
      const assignments = await db
        .select({
          assignment: workerStewardAssignments,
          employer: {
            id: employers.id,
            name: employers.name,
          },
          bargainingUnit: {
            id: bargainingUnits.id,
            name: bargainingUnits.name,
          },
        })
        .from(workerStewardAssignments)
        .leftJoin(employers, eq(workerStewardAssignments.employerId, employers.id))
        .leftJoin(bargainingUnits, eq(workerStewardAssignments.bargainingUnitId, bargainingUnits.id))
        .where(eq(workerStewardAssignments.workerId, workerId));

      return assignments.map(row => ({
        ...row.assignment,
        employer: row.employer || undefined,
        bargainingUnit: row.bargainingUnit || undefined,
      }));
    },

    async getAssignmentsByEmployerId(employerId: string): Promise<WorkerStewardAssignment[]> {
      return await db
        .select()
        .from(workerStewardAssignments)
        .where(eq(workerStewardAssignments.employerId, employerId));
    },

    async getAssignmentById(id: string): Promise<WorkerStewardAssignment | undefined> {
      const [assignment] = await db
        .select()
        .from(workerStewardAssignments)
        .where(eq(workerStewardAssignments.id, id));
      return assignment || undefined;
    },

    async createAssignment(data: InsertWorkerStewardAssignment): Promise<WorkerStewardAssignment> {
      const [assignment] = await db
        .insert(workerStewardAssignments)
        .values(data)
        .returning();
      return assignment;
    },

    async updateAssignment(id: string, data: Partial<InsertWorkerStewardAssignment>): Promise<WorkerStewardAssignment | undefined> {
      const [updated] = await db
        .update(workerStewardAssignments)
        .set(data)
        .where(eq(workerStewardAssignments.id, id))
        .returning();
      return updated || undefined;
    },

    async deleteAssignment(id: string): Promise<boolean> {
      const result = await db
        .delete(workerStewardAssignments)
        .where(eq(workerStewardAssignments.id, id))
        .returning();
      return result.length > 0;
    },

    async findExistingAssignment(workerId: string, employerId: string, bargainingUnitId: string): Promise<WorkerStewardAssignment | undefined> {
      const [assignment] = await db
        .select()
        .from(workerStewardAssignments)
        .where(and(
          eq(workerStewardAssignments.workerId, workerId),
          eq(workerStewardAssignments.employerId, employerId),
          eq(workerStewardAssignments.bargainingUnitId, bargainingUnitId)
        ));
      return assignment || undefined;
    },
  };

  return storage;
}

interface StewardAssemblyDependencies {
  workers: { getWorker(id: string): Promise<{ id: string; contactId: string } | undefined> };
  contacts: {
    getContact(id: string): Promise<{ id: string; displayName: string; email: string | null } | undefined>;
    phoneNumbers: {
      getPhoneNumbersByContact(contactId: string): Promise<{ phoneNumber: string; isPrimary: boolean }[]>;
    };
  };
  bargainingUnits: { getBargainingUnitById(id: string): Promise<{ id: string; name: string } | undefined> };
  workerStewardAssignments: { getAssignmentsByEmployerId(employerId: string): Promise<WorkerStewardAssignment[]> };
}

export async function assembleEmployerStewardDetails(
  storage: StewardAssemblyDependencies,
  employerId: string
): Promise<StewardByEmployerDetails[]> {
  const assignments = await storage.workerStewardAssignments.getAssignmentsByEmployerId(employerId);
  
  if (assignments.length === 0) {
    return [];
  }

  const workerIds = [...new Set(assignments.map(a => a.workerId))];
  const bargainingUnitIds = [...new Set(assignments.map(a => a.bargainingUnitId))];

  const [workersData, bargainingUnitsData] = await Promise.all([
    Promise.all(workerIds.map(id => storage.workers.getWorker(id))),
    Promise.all(bargainingUnitIds.map(id => storage.bargainingUnits.getBargainingUnitById(id))),
  ]);

  const workerMap = new Map(workersData.filter(Boolean).map(w => [w!.id, w!]));
  const bargainingUnitMap = new Map(bargainingUnitsData.filter(Boolean).map(bu => [bu!.id, bu!]));

  const contactIds = [...new Set([...workerMap.values()].map(w => w.contactId))];
  
  const [contactsData, phoneNumbersData] = await Promise.all([
    Promise.all(contactIds.map(id => storage.contacts.getContact(id))),
    Promise.all(contactIds.map(id => storage.contacts.phoneNumbers.getPhoneNumbersByContact(id))),
  ]);

  const contactMap = new Map(contactsData.filter(Boolean).map(c => [c!.id, c!]));
  const phoneNumberMap = new Map(contactIds.map((id, idx) => {
    const phones = phoneNumbersData[idx];
    const primary = phones.find(p => p.isPrimary);
    return [id, primary?.phoneNumber || null];
  }));

  const results: StewardByEmployerDetails[] = [];

  for (const assignment of assignments) {
    const worker = workerMap.get(assignment.workerId);
    if (!worker) {
      console.warn(`[worker-steward-assignments] Steward assignment ${assignment.id} references missing worker ${assignment.workerId}, skipping`);
      continue;
    }

    const contact = contactMap.get(worker.contactId);
    if (!contact) {
      console.warn(`[worker-steward-assignments] Worker ${worker.id} references missing contact ${worker.contactId}, skipping steward assignment ${assignment.id}`);
      continue;
    }

    const bargainingUnit = bargainingUnitMap.get(assignment.bargainingUnitId);
    const primaryPhoneNumber = phoneNumberMap.get(worker.contactId) || null;

    results.push({
      id: assignment.id,
      workerId: assignment.workerId,
      employerId: assignment.employerId,
      bargainingUnitId: assignment.bargainingUnitId,
      worker: { id: worker.id, contactId: worker.contactId },
      bargainingUnit: bargainingUnit 
        ? { id: bargainingUnit.id, name: bargainingUnit.name } 
        : { id: assignment.bargainingUnitId, name: "Unknown" },
      contact: { 
        id: contact.id, 
        displayName: contact.displayName, 
        email: contact.email, 
        primaryPhoneNumber 
      },
    });
  }

  return results;
}

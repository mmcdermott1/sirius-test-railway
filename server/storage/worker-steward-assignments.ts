import { db } from "../db";
import { workerStewardAssignments, employers, bargainingUnits, type WorkerStewardAssignment, type InsertWorkerStewardAssignment } from "@shared/schema";
import { eq, and } from "drizzle-orm";

export interface WorkerStewardAssignmentWithDetails extends WorkerStewardAssignment {
  employer?: { id: string; name: string };
  bargainingUnit?: { id: string; name: string };
}

export interface WorkerStewardAssignmentStorage {
  getAssignmentsByWorkerId(workerId: string): Promise<WorkerStewardAssignmentWithDetails[]>;
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

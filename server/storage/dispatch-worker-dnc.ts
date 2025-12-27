import { db } from "../db";
import { 
  dispatchWorkerDnc,
  workers,
  contacts,
  employers,
  type DispatchWorkerDnc, 
  type InsertDispatchWorkerDnc
} from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { type StorageLoggingConfig } from "./middleware/logging";

export interface DispatchWorkerDncWithRelations extends DispatchWorkerDnc {
  worker?: {
    id: string;
    siriusId: number | null;
    contact?: {
      id: string;
      given: string | null;
      family: string | null;
      displayName: string | null;
    } | null;
  } | null;
  employer?: {
    id: string;
    name: string;
  } | null;
}

export interface DispatchWorkerDncStorage {
  getAll(): Promise<DispatchWorkerDnc[]>;
  get(id: string): Promise<DispatchWorkerDnc | undefined>;
  getByWorker(workerId: string): Promise<DispatchWorkerDnc[]>;
  getByEmployer(employerId: string): Promise<DispatchWorkerDnc[]>;
  getByWorkerAndEmployer(workerId: string, employerId: string): Promise<DispatchWorkerDnc[]>;
  create(dnc: InsertDispatchWorkerDnc): Promise<DispatchWorkerDnc>;
  update(id: string, dnc: Partial<InsertDispatchWorkerDnc>): Promise<DispatchWorkerDnc | undefined>;
  delete(id: string): Promise<boolean>;
}

async function getWorkerName(workerId: string): Promise<string> {
  const [worker] = await db
    .select({ contactId: workers.contactId, siriusId: workers.siriusId })
    .from(workers)
    .where(eq(workers.id, workerId));
  if (!worker) return 'Unknown Worker';
  
  const [contact] = await db
    .select({ given: contacts.given, family: contacts.family, displayName: contacts.displayName })
    .from(contacts)
    .where(eq(contacts.id, worker.contactId));
  
  const name = contact ? `${contact.given || ''} ${contact.family || ''}`.trim() : '';
  return name || contact?.displayName || `Worker #${worker.siriusId}`;
}

async function getEmployerName(employerId: string): Promise<string> {
  const [employer] = await db
    .select({ name: employers.name })
    .from(employers)
    .where(eq(employers.id, employerId));
  return employer?.name || 'Unknown Employer';
}

export const dispatchWorkerDncLoggingConfig: StorageLoggingConfig<DispatchWorkerDncStorage> = {
  module: 'dispatch-worker-dnc',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new dispatch worker dnc',
      getHostEntityId: (args, result) => result?.workerId || args[0]?.workerId,
      getDescription: async (args, result) => {
        const workerName = await getWorkerName(result?.workerId || args[0]?.workerId);
        const employerName = await getEmployerName(result?.employerId || args[0]?.employerId);
        return `Created DNC entry (${result?.type}) for ${workerName} at ${employerName}`;
      },
      after: async (args, result) => {
        return { dnc: result };
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return result?.workerId || beforeState?.dnc?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        const workerName = await getWorkerName(result?.workerId || beforeState?.dnc?.workerId);
        const employerName = await getEmployerName(result?.employerId || beforeState?.dnc?.employerId);
        return `Updated DNC entry for ${workerName} at ${employerName}`;
      },
      before: async (args, storage) => {
        const dnc = await storage.get(args[0]);
        return { dnc };
      },
      after: async (args, result) => {
        return { dnc: result };
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return beforeState?.dnc?.workerId;
      },
      getDescription: async (args, result, beforeState) => {
        if (beforeState?.dnc) {
          const workerName = await getWorkerName(beforeState.dnc.workerId);
          const employerName = await getEmployerName(beforeState.dnc.employerId);
          return `Deleted DNC entry (${beforeState.dnc.type}) for ${workerName} at ${employerName}`;
        }
        return 'Deleted dispatch worker DNC entry';
      },
      before: async (args, storage) => {
        const dnc = await storage.get(args[0]);
        return { dnc };
      }
    }
  }
};

export function createDispatchWorkerDncStorage(): DispatchWorkerDncStorage {
  return {
    async getAll() {
      return await db.select().from(dispatchWorkerDnc);
    },

    async get(id: string) {
      const [result] = await db
        .select()
        .from(dispatchWorkerDnc)
        .where(eq(dispatchWorkerDnc.id, id));
      return result;
    },

    async getByWorker(workerId: string) {
      return await db
        .select()
        .from(dispatchWorkerDnc)
        .where(eq(dispatchWorkerDnc.workerId, workerId));
    },

    async getByEmployer(employerId: string) {
      return await db
        .select()
        .from(dispatchWorkerDnc)
        .where(eq(dispatchWorkerDnc.employerId, employerId));
    },

    async getByWorkerAndEmployer(workerId: string, employerId: string) {
      return await db
        .select()
        .from(dispatchWorkerDnc)
        .where(and(
          eq(dispatchWorkerDnc.workerId, workerId),
          eq(dispatchWorkerDnc.employerId, employerId)
        ));
    },

    async create(dnc: InsertDispatchWorkerDnc) {
      const [result] = await db
        .insert(dispatchWorkerDnc)
        .values(dnc)
        .returning();
      return result;
    },

    async update(id: string, dnc: Partial<InsertDispatchWorkerDnc>) {
      const [result] = await db
        .update(dispatchWorkerDnc)
        .set(dnc)
        .where(eq(dispatchWorkerDnc.id, id))
        .returning();
      return result;
    },

    async delete(id: string) {
      const result = await db
        .delete(dispatchWorkerDnc)
        .where(eq(dispatchWorkerDnc.id, id))
        .returning();
      return result.length > 0;
    }
  };
}

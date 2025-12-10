import { db } from "../db";
import { esigs, cardchecks, cardcheckDefinitions, files, users, workers, contacts, type Esig, type InsertEsig, type Cardcheck } from "@shared/schema";
import { eq } from "drizzle-orm";
import type { StorageLoggingConfig } from "./middleware/logging";
import crypto from "crypto";

export interface EsigWithSigner extends Esig {
  signer?: {
    id: string;
    email: string;
    firstName: string | null;
    lastName: string | null;
  };
}

export interface SignCardcheckParams {
  cardcheckId: string;
  userId: string;
  docRender: string;
  docType: string;
  esigData: any;
  signatureType: string;
  fileId?: string;
  rate?: number;
}

export interface SignCardcheckResult {
  esig: Esig;
  cardcheck: Cardcheck;
}

export interface EsigStorage {
  getEsigById(id: string): Promise<EsigWithSigner | undefined>;
  createEsig(data: InsertEsig): Promise<Esig>;
  updateEsig(id: string, data: Partial<InsertEsig>): Promise<Esig | undefined>;
  signCardcheck(params: SignCardcheckParams): Promise<SignCardcheckResult>;
}

export function createEsigStorage(): EsigStorage {
  const storage: EsigStorage = {
    async getEsigById(id: string): Promise<EsigWithSigner | undefined> {
      const result = await db
        .select({
          esig: esigs,
          user: {
            id: users.id,
            email: users.email,
            firstName: users.firstName,
            lastName: users.lastName,
          },
        })
        .from(esigs)
        .leftJoin(users, eq(esigs.userId, users.id))
        .where(eq(esigs.id, id));
      
      if (!result.length) return undefined;
      
      const { esig, user } = result[0];
      return {
        ...esig,
        signer: user ? {
          id: user.id,
          email: user.email,
          firstName: user.firstName,
          lastName: user.lastName,
        } : undefined,
      };
    },

    async createEsig(data: InsertEsig): Promise<Esig> {
      const [esig] = await db
        .insert(esigs)
        .values(data)
        .returning();
      return esig;
    },

    async updateEsig(id: string, data: Partial<InsertEsig>): Promise<Esig | undefined> {
      const [updated] = await db
        .update(esigs)
        .set(data)
        .where(eq(esigs.id, id))
        .returning();
      return updated || undefined;
    },

    async signCardcheck(params: SignCardcheckParams): Promise<SignCardcheckResult> {
      const { cardcheckId, userId, docRender, docType, esigData, signatureType, fileId, rate } = params;
      const docHash = crypto.createHash("sha256").update(docRender).digest("hex");

      return db.transaction(async (tx) => {
        // If signing with an uploaded file, validate file ownership
        if (fileId && signatureType === "upload") {
          const [file] = await tx
            .select()
            .from(files)
            .where(eq(files.id, fileId));
          
          if (!file) {
            throw new Error("Referenced file not found");
          }
          
          if (file.uploadedBy !== userId) {
            throw new Error("You are not authorized to sign with this file");
          }
        }

        const [newEsig] = await tx
          .insert(esigs)
          .values({
            userId,
            status: "signed",
            signedDate: new Date(),
            type: signatureType === "upload" ? "upload" : "online",
            docRender,
            docHash,
            esig: esigData,
            docType,
          })
          .returning();

        // Link the file to the esig if present
        if (fileId && signatureType === "upload") {
          await tx
            .update(files)
            .set({
              entityType: "esig",
              entityId: newEsig.id,
            })
            .where(eq(files.id, fileId));
        }

        const [updatedCardcheck] = await tx
          .update(cardchecks)
          .set({
            status: "signed",
            signedDate: new Date(),
            esigId: newEsig.id,
            rate: rate,
          })
          .where(eq(cardchecks.id, cardcheckId))
          .returning();

        return { esig: newEsig, cardcheck: updatedCardcheck };
      });
    },
  };

  return storage;
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

async function getDefinitionName(definitionId: string): Promise<string> {
  const [definition] = await db
    .select({ name: cardcheckDefinitions.name, siriusId: cardcheckDefinitions.siriusId })
    .from(cardcheckDefinitions)
    .where(eq(cardcheckDefinitions.id, definitionId));
  return definition ? `[${definition.siriusId}] ${definition.name}` : 'Unknown Definition';
}

async function getCardcheckInfo(cardcheckId: string): Promise<{ workerId: string; definitionId: string } | null> {
  const [cardcheck] = await db
    .select({ workerId: cardchecks.workerId, cardcheckDefinitionId: cardchecks.cardcheckDefinitionId })
    .from(cardchecks)
    .where(eq(cardchecks.id, cardcheckId));
  return cardcheck ? { workerId: cardcheck.workerId, definitionId: cardcheck.cardcheckDefinitionId } : null;
}

export const esigLoggingConfig: StorageLoggingConfig<EsigStorage> = {
  module: 'esigs',
  methods: {
    createEsig: {
      enabled: true,
      getEntityId: (args, result) => result?.id || 'new esig',
      getHostEntityId: (args, result) => result?.userId || args[0]?.userId,
      getDescription: async (args, result) => {
        return `Created e-signature for document type: ${result?.docType || args[0]?.docType || 'unknown'}`;
      },
      after: async (args, result) => {
        return {
          esig: result,
          metadata: {
            esigId: result?.id,
            userId: result?.userId,
            docType: result?.docType,
            status: result?.status,
          }
        };
      }
    },
    updateEsig: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, beforeState) => {
        return result?.userId || beforeState?.esig?.userId;
      },
      getDescription: async (args, result, beforeState) => {
        const oldStatus = beforeState?.esig?.status;
        const newStatus = result?.status;
        if (oldStatus && newStatus && oldStatus !== newStatus) {
          return `Updated e-signature: ${oldStatus} → ${newStatus}`;
        }
        return `Updated e-signature`;
      },
      before: async (args, storage) => {
        const esig = await storage.getEsigById(args[0]);
        return { esig };
      },
      after: async (args, result, _storage, beforeState) => {
        return {
          esig: result,
          previousState: beforeState?.esig,
          metadata: {
            esigId: result?.id,
            userId: result?.userId,
            docType: result?.docType,
            status: result?.status,
            previousStatus: beforeState?.esig?.status,
          }
        };
      }
    },
    signCardcheck: {
      enabled: true,
      getEntityId: (args, result) => result?.cardcheck?.id || args[0]?.cardcheckId,
      getHostEntityId: async (args, result) => {
        if (result?.cardcheck?.workerId) {
          return result.cardcheck.workerId;
        }
        const info = await getCardcheckInfo(args[0]?.cardcheckId);
        return info?.workerId;
      },
      getDescription: async (args, result) => {
        const cardcheckId = result?.cardcheck?.id || args[0]?.cardcheckId;
        const info = await getCardcheckInfo(cardcheckId);
        if (!info) return 'Signed Cardcheck';
        const workerName = await getWorkerName(info.workerId);
        const definitionName = await getDefinitionName(info.definitionId);
        return `Signed Cardcheck for ${workerName} - ${definitionName}`;
      },
      after: async (args, result) => {
        return {
          cardcheck: result?.cardcheck,
          esig: result?.esig,
          metadata: {
            cardcheckId: result?.cardcheck?.id,
            esigId: result?.esig?.id,
            workerId: result?.cardcheck?.workerId,
            cardcheckDefinitionId: result?.cardcheck?.cardcheckDefinitionId,
            status: result?.cardcheck?.status,
            rate: result?.cardcheck?.rate,
          }
        };
      }
    },
  },
};

import { db } from "../db";
import { ledgerAccounts, ledgerStripePaymentMethods, ledgerEa } from "@shared/schema";
import type { 
  LedgerAccount, 
  InsertLedgerAccount,
  LedgerStripePaymentMethod,
  InsertLedgerStripePaymentMethod,
  SelectLedgerEa,
  InsertLedgerEa
} from "@shared/schema";
import { eq, and, desc } from "drizzle-orm";
import { withStorageLogging, type StorageLoggingConfig } from "./middleware/logging";

export interface LedgerAccountStorage {
  getAll(): Promise<LedgerAccount[]>;
  get(id: string): Promise<LedgerAccount | undefined>;
  create(account: InsertLedgerAccount): Promise<LedgerAccount>;
  update(id: string, account: Partial<InsertLedgerAccount>): Promise<LedgerAccount | undefined>;
  delete(id: string): Promise<boolean>;
}

export interface StripePaymentMethodStorage {
  getAll(): Promise<LedgerStripePaymentMethod[]>;
  get(id: string): Promise<LedgerStripePaymentMethod | undefined>;
  getByEntity(entityType: string, entityId: string): Promise<LedgerStripePaymentMethod[]>;
  create(method: InsertLedgerStripePaymentMethod): Promise<LedgerStripePaymentMethod>;
  update(id: string, method: Partial<InsertLedgerStripePaymentMethod>): Promise<LedgerStripePaymentMethod | undefined>;
  delete(id: string): Promise<boolean>;
  setAsDefault(paymentMethodId: string, entityType: string, entityId: string): Promise<LedgerStripePaymentMethod | undefined>;
}

export interface LedgerEaStorage {
  getAll(): Promise<SelectLedgerEa[]>;
  get(id: string): Promise<SelectLedgerEa | undefined>;
  getByEntity(entityType: string, entityId: string): Promise<SelectLedgerEa[]>;
  create(entry: InsertLedgerEa): Promise<SelectLedgerEa>;
  update(id: string, entry: Partial<InsertLedgerEa>): Promise<SelectLedgerEa | undefined>;
  delete(id: string): Promise<boolean>;
}

export interface LedgerStorage {
  accounts: LedgerAccountStorage;
  stripePaymentMethods: StripePaymentMethodStorage;
  ea: LedgerEaStorage;
}

export function createLedgerAccountStorage(): LedgerAccountStorage {
  return {
    async getAll(): Promise<LedgerAccount[]> {
      const results = await db.select().from(ledgerAccounts);
      return results;
    },

    async get(id: string): Promise<LedgerAccount | undefined> {
      const [account] = await db.select().from(ledgerAccounts).where(eq(ledgerAccounts.id, id));
      return account || undefined;
    },

    async create(insertAccount: InsertLedgerAccount): Promise<LedgerAccount> {
      const [account] = await db.insert(ledgerAccounts).values(insertAccount).returning();
      return account;
    },

    async update(id: string, accountUpdate: Partial<InsertLedgerAccount>): Promise<LedgerAccount | undefined> {
      const [account] = await db.update(ledgerAccounts)
        .set(accountUpdate)
        .where(eq(ledgerAccounts.id, id))
        .returning();
      return account || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(ledgerAccounts).where(eq(ledgerAccounts.id, id));
      return result.rowCount ? result.rowCount > 0 : false;
    }
  };
}

export function createStripePaymentMethodStorage(): StripePaymentMethodStorage {
  return {
    async getAll(): Promise<LedgerStripePaymentMethod[]> {
      return await db.select().from(ledgerStripePaymentMethods)
        .orderBy(desc(ledgerStripePaymentMethods.createdAt));
    },

    async get(id: string): Promise<LedgerStripePaymentMethod | undefined> {
      const [paymentMethod] = await db.select().from(ledgerStripePaymentMethods)
        .where(eq(ledgerStripePaymentMethods.id, id));
      return paymentMethod || undefined;
    },

    async getByEntity(entityType: string, entityId: string): Promise<LedgerStripePaymentMethod[]> {
      return await db.select().from(ledgerStripePaymentMethods)
        .where(and(
          eq(ledgerStripePaymentMethods.entityType, entityType),
          eq(ledgerStripePaymentMethods.entityId, entityId)
        ))
        .orderBy(desc(ledgerStripePaymentMethods.isDefault), desc(ledgerStripePaymentMethods.createdAt));
    },

    async create(insertPaymentMethod: InsertLedgerStripePaymentMethod): Promise<LedgerStripePaymentMethod> {
      const [paymentMethod] = await db.insert(ledgerStripePaymentMethods)
        .values(insertPaymentMethod)
        .returning();
      return paymentMethod;
    },

    async update(id: string, paymentMethodUpdate: Partial<InsertLedgerStripePaymentMethod>): Promise<LedgerStripePaymentMethod | undefined> {
      const [paymentMethod] = await db.update(ledgerStripePaymentMethods)
        .set(paymentMethodUpdate)
        .where(eq(ledgerStripePaymentMethods.id, id))
        .returning();
      return paymentMethod || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(ledgerStripePaymentMethods)
        .where(eq(ledgerStripePaymentMethods.id, id))
        .returning();
      return result.length > 0;
    },

    async setAsDefault(paymentMethodId: string, entityType: string, entityId: string): Promise<LedgerStripePaymentMethod | undefined> {
      await db
        .update(ledgerStripePaymentMethods)
        .set({ isDefault: false })
        .where(and(
          eq(ledgerStripePaymentMethods.entityType, entityType),
          eq(ledgerStripePaymentMethods.entityId, entityId)
        ));
      
      const [paymentMethod] = await db
        .update(ledgerStripePaymentMethods)
        .set({ isDefault: true })
        .where(and(
          eq(ledgerStripePaymentMethods.id, paymentMethodId),
          eq(ledgerStripePaymentMethods.entityType, entityType),
          eq(ledgerStripePaymentMethods.entityId, entityId)
        ))
        .returning();
      
      return paymentMethod || undefined;
    }
  };
}

export function createLedgerEaStorage(): LedgerEaStorage {
  return {
    async getAll(): Promise<SelectLedgerEa[]> {
      return await db.select().from(ledgerEa);
    },

    async get(id: string): Promise<SelectLedgerEa | undefined> {
      const [entry] = await db.select().from(ledgerEa).where(eq(ledgerEa.id, id));
      return entry || undefined;
    },

    async getByEntity(entityType: string, entityId: string): Promise<SelectLedgerEa[]> {
      return await db.select().from(ledgerEa)
        .where(and(
          eq(ledgerEa.entityType, entityType),
          eq(ledgerEa.entityId, entityId)
        ));
    },

    async create(insertEntry: InsertLedgerEa): Promise<SelectLedgerEa> {
      const [entry] = await db.insert(ledgerEa).values(insertEntry).returning();
      return entry;
    },

    async update(id: string, entryUpdate: Partial<InsertLedgerEa>): Promise<SelectLedgerEa | undefined> {
      const [entry] = await db.update(ledgerEa)
        .set(entryUpdate)
        .where(eq(ledgerEa.id, id))
        .returning();
      return entry || undefined;
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(ledgerEa).where(eq(ledgerEa.id, id));
      return result.rowCount ? result.rowCount > 0 : false;
    }
  };
}

export function createLedgerStorage(
  accountLoggingConfig?: StorageLoggingConfig<LedgerAccountStorage>,
  stripePaymentMethodLoggingConfig?: StorageLoggingConfig<StripePaymentMethodStorage>,
  eaLoggingConfig?: StorageLoggingConfig<LedgerEaStorage>
): LedgerStorage {
  // Create nested storage instances with optional logging
  const accountStorage = accountLoggingConfig
    ? withStorageLogging(createLedgerAccountStorage(), accountLoggingConfig)
    : createLedgerAccountStorage();
  
  const stripePaymentMethodStorage = stripePaymentMethodLoggingConfig
    ? withStorageLogging(createStripePaymentMethodStorage(), stripePaymentMethodLoggingConfig)
    : createStripePaymentMethodStorage();

  const eaStorage = eaLoggingConfig
    ? withStorageLogging(createLedgerEaStorage(), eaLoggingConfig)
    : createLedgerEaStorage();
  
  return {
    accounts: accountStorage,
    stripePaymentMethods: stripePaymentMethodStorage,
    ea: eaStorage
  };
}

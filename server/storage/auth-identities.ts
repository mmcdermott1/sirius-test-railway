import { eq, and } from "drizzle-orm";
import { db } from "../db";
import { authIdentities, type AuthIdentity, type InsertAuthIdentity, type AuthProviderType } from "@shared/schema";

export interface AuthIdentityStorage {
  getById(id: string): Promise<AuthIdentity | undefined>;
  getByUserId(userId: string): Promise<AuthIdentity[]>;
  getByProviderAndExternalId(providerType: AuthProviderType, externalId: string): Promise<AuthIdentity | undefined>;
  create(identity: InsertAuthIdentity): Promise<AuthIdentity>;
  updateLastUsed(id: string): Promise<void>;
  delete(id: string): Promise<boolean>;
  deleteByUserId(userId: string): Promise<number>;
}

export function createAuthIdentityStorage(): AuthIdentityStorage {
  return {
    async getById(id: string): Promise<AuthIdentity | undefined> {
      const result = await db
        .select()
        .from(authIdentities)
        .where(eq(authIdentities.id, id))
        .limit(1);
      return result[0];
    },

    async getByUserId(userId: string): Promise<AuthIdentity[]> {
      return db
        .select()
        .from(authIdentities)
        .where(eq(authIdentities.userId, userId));
    },

    async getByProviderAndExternalId(
      providerType: AuthProviderType,
      externalId: string
    ): Promise<AuthIdentity | undefined> {
      const result = await db
        .select()
        .from(authIdentities)
        .where(
          and(
            eq(authIdentities.providerType, providerType),
            eq(authIdentities.externalId, externalId)
          )
        )
        .limit(1);
      return result[0];
    },

    async create(identity: InsertAuthIdentity): Promise<AuthIdentity> {
      const result = await db
        .insert(authIdentities)
        .values(identity)
        .returning();
      return result[0];
    },

    async updateLastUsed(id: string): Promise<void> {
      await db
        .update(authIdentities)
        .set({ 
          lastUsedAt: new Date(),
          updatedAt: new Date(),
        })
        .where(eq(authIdentities.id, id));
    },

    async delete(id: string): Promise<boolean> {
      const result = await db
        .delete(authIdentities)
        .where(eq(authIdentities.id, id))
        .returning();
      return result.length > 0;
    },

    async deleteByUserId(userId: string): Promise<number> {
      const result = await db
        .delete(authIdentities)
        .where(eq(authIdentities.userId, userId))
        .returning();
      return result.length;
    },
  };
}

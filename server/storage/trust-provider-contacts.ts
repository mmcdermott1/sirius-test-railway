import { db } from "../db";
import { trustProviderContacts, contacts, optionsEmployerContactType, trustProviders, type TrustProviderContact, type InsertTrustProviderContact, type Contact, type InsertContact, type TrustProvider } from "@shared/schema";
import { eq, and, or, ilike } from "drizzle-orm";
import { withStorageLogging, type StorageLoggingConfig } from "./middleware/logging";
import type { ContactsStorage } from "./contacts";

export interface TrustProviderContactStorage {
  create(data: { providerId: string; contactData: InsertContact & { email: string }; contactTypeId?: string | null }): Promise<{ providerContact: TrustProviderContact; contact: Contact }>;
  listByProvider(providerId: string): Promise<Array<TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }>>;
  getAll(filters?: { providerId?: string; contactName?: string; contactTypeId?: string }): Promise<Array<TrustProviderContact & { contact: Contact; provider: TrustProvider; contactType?: { id: string; name: string; description: string | null } | null }>>;
  get(id: string): Promise<(TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null>;
  update(id: string, data: { contactTypeId?: string | null }): Promise<(TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null>;
  updateContactEmail(id: string, email: string | null): Promise<(TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null>;
  updateContactName(id: string, components: {
    title?: string;
    given?: string;
    middle?: string;
    family?: string;
    generational?: string;
    credentials?: string;
  }): Promise<(TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null>;
  delete(id: string): Promise<boolean>;
}

export function createTrustProviderContactStorage(contactsStorage: ContactsStorage): TrustProviderContactStorage {
  return {
    async create(data: { providerId: string; contactData: InsertContact & { email: string }; contactTypeId?: string | null }): Promise<{ providerContact: TrustProviderContact; contact: Contact }> {
      // Validate email is provided
      if (!data.contactData.email || !data.contactData.email.trim()) {
        throw new Error("Email is required for provider contacts");
      }

      // Create the contact first
      const [contact] = await db
        .insert(contacts)
        .values(data.contactData)
        .returning();

      // Create the provider contact relationship
      const [providerContact] = await db
        .insert(trustProviderContacts)
        .values({
          providerId: data.providerId,
          contactId: contact.id,
          contactTypeId: data.contactTypeId || null,
        })
        .returning();

      return { providerContact, contact };
    },

    async listByProvider(providerId: string): Promise<Array<TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }>> {
      const results = await db
        .select({
          providerContact: trustProviderContacts,
          contact: contacts,
          contactType: optionsEmployerContactType,
        })
        .from(trustProviderContacts)
        .innerJoin(contacts, eq(trustProviderContacts.contactId, contacts.id))
        .leftJoin(optionsEmployerContactType, eq(trustProviderContacts.contactTypeId, optionsEmployerContactType.id))
        .where(eq(trustProviderContacts.providerId, providerId));

      return results.map(row => ({
        ...row.providerContact,
        contact: row.contact,
        contactType: row.contactType,
      }));
    },

    async getAll(filters?: { providerId?: string; contactName?: string; contactTypeId?: string }): Promise<Array<TrustProviderContact & { contact: Contact; provider: TrustProvider; contactType?: { id: string; name: string; description: string | null } | null }>> {
      let query = db
        .select({
          providerContact: trustProviderContacts,
          contact: contacts,
          provider: trustProviders,
          contactType: optionsEmployerContactType,
        })
        .from(trustProviderContacts)
        .innerJoin(contacts, eq(trustProviderContacts.contactId, contacts.id))
        .innerJoin(trustProviders, eq(trustProviderContacts.providerId, trustProviders.id))
        .leftJoin(optionsEmployerContactType, eq(trustProviderContacts.contactTypeId, optionsEmployerContactType.id));

      const conditions = [];

      if (filters?.providerId) {
        conditions.push(eq(trustProviderContacts.providerId, filters.providerId));
      }

      if (filters?.contactTypeId) {
        conditions.push(eq(trustProviderContacts.contactTypeId, filters.contactTypeId));
      }

      if (filters?.contactName) {
        const searchTerm = `%${filters.contactName}%`;
        conditions.push(
          or(
            ilike(contacts.displayName, searchTerm),
            ilike(contacts.given, searchTerm),
            ilike(contacts.family, searchTerm),
            ilike(contacts.email, searchTerm)
          )!
        );
      }

      if (conditions.length > 0) {
        query = query.where(and(...conditions)!) as any;
      }

      const results = await query;

      return results.map(row => ({
        ...row.providerContact,
        contact: row.contact,
        provider: row.provider,
        contactType: row.contactType,
      }));
    },

    async get(id: string): Promise<(TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null> {
      const results = await db
        .select({
          providerContact: trustProviderContacts,
          contact: contacts,
          contactType: optionsEmployerContactType,
        })
        .from(trustProviderContacts)
        .innerJoin(contacts, eq(trustProviderContacts.contactId, contacts.id))
        .leftJoin(optionsEmployerContactType, eq(trustProviderContacts.contactTypeId, optionsEmployerContactType.id))
        .where(eq(trustProviderContacts.id, id));

      if (results.length === 0) {
        return null;
      }

      const row = results[0];
      return {
        ...row.providerContact,
        contact: row.contact,
        contactType: row.contactType,
      };
    },

    async update(id: string, data: { contactTypeId?: string | null }): Promise<(TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null> {
      const [updated] = await db
        .update(trustProviderContacts)
        .set({ contactTypeId: data.contactTypeId })
        .where(eq(trustProviderContacts.id, id))
        .returning();

      if (!updated) {
        return null;
      }

      return this.get(id);
    },

    async updateContactEmail(id: string, email: string | null): Promise<(TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null> {
      const providerContact = await this.get(id);
      if (!providerContact) {
        return null;
      }

      await contactsStorage.updateEmail(providerContact.contactId, email);
      return this.get(id);
    },

    async updateContactName(id: string, components: {
      title?: string;
      given?: string;
      middle?: string;
      family?: string;
      generational?: string;
      credentials?: string;
    }): Promise<(TrustProviderContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null> {
      const providerContact = await this.get(id);
      if (!providerContact) {
        return null;
      }

      await contactsStorage.updateNameComponents(providerContact.contactId, components);
      return this.get(id);
    },

    async delete(id: string): Promise<boolean> {
      const result = await db
        .delete(trustProviderContacts)
        .where(eq(trustProviderContacts.id, id))
        .returning();

      return result.length > 0;
    },
  };
}

export const trustProviderContactLoggingConfig: StorageLoggingConfig<TrustProviderContactStorage> = {
  module: 'trust-provider-contacts',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args, result) => result?.contact?.displayName || result?.contact?.email,
      getHostEntityId: (args) => args[0]?.providerId,
      after: async (args, result) => result,
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, storage) => {
        const providerContact = await storage.get(args[0]);
        return providerContact?.providerId;
      },
      before: async (args, storage) => await storage.get(args[0]),
      after: async (args, result) => result,
    },
    updateContactEmail: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, storage) => {
        const providerContact = await storage.get(args[0]);
        return providerContact?.providerId;
      },
      before: async (args, storage) => await storage.get(args[0]),
      after: async (args, result) => result,
    },
    updateContactName: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, storage) => {
        const providerContact = await storage.get(args[0]);
        return providerContact?.providerId;
      },
      before: async (args, storage) => await storage.get(args[0]),
      after: async (args, result) => result,
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      getHostEntityId: async (args, result, storage) => {
        const providerContact = await storage.get(args[0]);
        return providerContact?.providerId;
      },
      before: async (args, storage) => await storage.get(args[0]),
    },
  },
};

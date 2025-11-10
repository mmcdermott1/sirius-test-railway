import { db } from "../db";
import { employerContacts, contacts, optionsEmployerContactType, type EmployerContact, type InsertEmployerContact, type Contact, type InsertContact } from "@shared/schema";
import { eq, and } from "drizzle-orm";
import { withStorageLogging, type StorageLoggingConfig } from "./middleware/logging";
import type { ContactsStorage } from "./contacts";

export interface EmployerContactStorage {
  create(data: { employerId: string; contactData: InsertContact & { email: string }; contactTypeId?: string | null }): Promise<{ employerContact: EmployerContact; contact: Contact }>;
  listByEmployer(employerId: string): Promise<Array<EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }>>;
  get(id: string): Promise<(EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null>;
  update(id: string, data: { contactTypeId?: string | null }): Promise<EmployerContact | null>;
  updateContactEmail(id: string, email: string | null): Promise<(EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null>;
  updateContactName(id: string, components: {
    title?: string;
    given?: string;
    middle?: string;
    family?: string;
    generational?: string;
    credentials?: string;
  }): Promise<(EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null>;
  delete(id: string): Promise<boolean>;
}

export function createEmployerContactStorage(contactsStorage: ContactsStorage): EmployerContactStorage {
  return {
    async create(data: { employerId: string; contactData: InsertContact & { email: string }; contactTypeId?: string | null }): Promise<{ employerContact: EmployerContact; contact: Contact }> {
      // Validate email is provided
      if (!data.contactData.email || !data.contactData.email.trim()) {
        throw new Error("Email is required for employer contacts");
      }

      // Create the contact first
      const [contact] = await db
        .insert(contacts)
        .values(data.contactData)
        .returning();

      // Create the employer contact relationship
      const [employerContact] = await db
        .insert(employerContacts)
        .values({
          employerId: data.employerId,
          contactId: contact.id,
          contactTypeId: data.contactTypeId || null,
        })
        .returning();

      return { employerContact, contact };
    },

    async listByEmployer(employerId: string): Promise<Array<EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }>> {
      const results = await db
        .select({
          employerContact: employerContacts,
          contact: contacts,
          contactType: optionsEmployerContactType,
        })
        .from(employerContacts)
        .innerJoin(contacts, eq(employerContacts.contactId, contacts.id))
        .leftJoin(optionsEmployerContactType, eq(employerContacts.contactTypeId, optionsEmployerContactType.id))
        .where(eq(employerContacts.employerId, employerId));

      return results.map(row => ({
        ...row.employerContact,
        contact: row.contact,
        contactType: row.contactType,
      }));
    },

    async get(id: string): Promise<(EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null> {
      const results = await db
        .select({
          employerContact: employerContacts,
          contact: contacts,
          contactType: optionsEmployerContactType,
        })
        .from(employerContacts)
        .innerJoin(contacts, eq(employerContacts.contactId, contacts.id))
        .leftJoin(optionsEmployerContactType, eq(employerContacts.contactTypeId, optionsEmployerContactType.id))
        .where(eq(employerContacts.id, id));

      if (results.length === 0) {
        return null;
      }

      const row = results[0];
      return {
        ...row.employerContact,
        contact: row.contact,
        contactType: row.contactType,
      };
    },

    async update(id: string, data: { contactTypeId?: string | null }): Promise<EmployerContact | null> {
      const [updated] = await db
        .update(employerContacts)
        .set({ contactTypeId: data.contactTypeId })
        .where(eq(employerContacts.id, id))
        .returning();

      return updated || null;
    },

    async updateContactEmail(id: string, email: string | null): Promise<(EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null> {
      const employerContact = await db.query.employerContacts.findFirst({
        where: eq(employerContacts.id, id),
      });

      if (!employerContact) {
        return null;
      }

      const normalizedEmail = email === null || email === "null" || email?.trim() === "" ? null : email.trim();

      await db
        .update(contacts)
        .set({ email: normalizedEmail })
        .where(eq(contacts.id, employerContact.contactId));

      return this.get(id);
    },

    async updateContactName(
      id: string,
      components: {
        title?: string;
        given?: string;
        middle?: string;
        family?: string;
        generational?: string;
        credentials?: string;
      }
    ): Promise<(EmployerContact & { contact: Contact; contactType?: { id: string; name: string; description: string | null } | null }) | null> {
      const employerContact = await db.query.employerContacts.findFirst({
        where: eq(employerContacts.id, id),
      });

      if (!employerContact) {
        return null;
      }

      await contactsStorage.updateNameComponents(employerContact.contactId, components);

      return this.get(id);
    },

    async delete(id: string): Promise<boolean> {
      const result = await db.delete(employerContacts).where(eq(employerContacts.id, id)).returning();
      return result.length > 0;
    },
  };
}

export const employerContactLoggingConfig: StorageLoggingConfig<EmployerContactStorage> = {
  module: 'employerContacts',
  methods: {
    create: {
      enabled: true,
      getEntityId: (args) => args[0]?.employerId || 'new employer contact',
      after: async (args, result, storage) => {
        return result;
      }
    },
    update: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.get(args[0]);
      },
      after: async (args, result, storage) => {
        return result;
      }
    },
    updateContactEmail: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.get(args[0]);
      },
      after: async (args, result, storage) => {
        return await storage.get(args[0]);
      }
    },
    updateContactName: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => {
        return await storage.get(args[0]);
      },
      after: async (args, result, storage) => {
        return await storage.get(args[0]);
      }
    },
    delete: {
      enabled: true,
      getEntityId: (args) => args[0],
      before: async (args, storage) => {
        const results = await db.select().from(employerContacts).where(eq(employerContacts.id, args[0]));
        return results[0];
      }
    }
  }
};

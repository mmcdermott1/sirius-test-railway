import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { insertContactSchema, type InsertContact } from "@shared/schema";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";
import { z } from "zod";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerTrustProviderContactRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {

  // GET /api/trust-provider-contacts - Get all provider contacts with optional filtering (requires staff policy)
  app.get("/api/trust-provider-contacts", requireAuth, requireAccess(policies.staff), async (req, res) => {
    try {
      const { providerId, contactName, contactTypeId } = req.query;
      
      const filters: { providerId?: string; contactName?: string; contactTypeId?: string } = {};
      
      if (providerId && typeof providerId === 'string') {
        filters.providerId = providerId;
      }
      
      if (contactName && typeof contactName === 'string') {
        filters.contactName = contactName;
      }
      
      if (contactTypeId && typeof contactTypeId === 'string') {
        filters.contactTypeId = contactTypeId;
      }
      
      const providerContacts = await storage.trustProviderContacts.getAll(filters);
      res.json(providerContacts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch provider contacts" });
    }
  });

  // GET /api/trust-providers/:providerId/contacts - Get all contacts for a provider (requires staff policy)
  app.get("/api/trust-providers/:providerId/contacts", requireAuth, requireAccess(policies.staff), async (req, res) => {
    try {
      const { providerId } = req.params;
      const contacts = await storage.trustProviderContacts.listByProvider(providerId);
      res.json(contacts);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch provider contacts" });
    }
  });

  // POST /api/trust-providers/:providerId/contacts - Create a new contact for a provider (requires admin policy)
  app.post("/api/trust-providers/:providerId/contacts", requireAuth, requireAccess(policies.admin), async (req, res) => {
    try {
      const { providerId } = req.params;
      const parsed = insertContactSchema.extend({ 
        email: z.string().email("Valid email is required"),
        contactTypeId: z.string().optional().nullable()
      }).safeParse(req.body);
      
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid contact data", errors: parsed.error.errors });
      }

      const { contactTypeId, ...contactData } = parsed.data;
      
      const result = await storage.trustProviderContacts.create({
        providerId,
        contactData: contactData as InsertContact & { email: string },
        contactTypeId: contactTypeId || null,
      });
      
      res.status(201).json(result);
    } catch (error: any) {
      if (error.message === "Email is required for provider contacts") {
        return res.status(400).json({ message: error.message });
      }
      // Handle duplicate email constraint violation
      if (error.code === '23505' && error.constraint === 'contacts_email_unique') {
        return res.status(409).json({ message: "A contact with this email already exists. Providers cannot add existing contacts, only create new ones." });
      }
      res.status(500).json({ message: "Failed to create provider contact" });
    }
  });

  // GET /api/trust-provider-contacts/:id - Get a single provider contact (requires staff policy)
  app.get("/api/trust-provider-contacts/:id", requireAuth, requireAccess(policies.staff), async (req, res) => {
    try {
      const { id } = req.params;
      const providerContact = await storage.trustProviderContacts.get(id);
      
      if (!providerContact) {
        res.status(404).json({ message: "Provider contact not found" });
        return;
      }
      
      res.json(providerContact);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch provider contact" });
    }
  });

  // PATCH /api/trust-provider-contacts/:id - Update a provider contact (requires admin policy)
  app.patch("/api/trust-provider-contacts/:id", requireAuth, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const updateSchema = z.object({
        contactTypeId: z.string().nullable().optional(),
      });
      
      const parsed = updateSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid data", errors: parsed.error.errors });
      }

      const result = await storage.trustProviderContacts.update(id, parsed.data);

      if (!result) {
        return res.status(404).json({ message: "Provider contact not found" });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to update provider contact" });
    }
  });

  // PATCH /api/trust-provider-contacts/:id/contact/email - Update contact email (requires admin policy)
  app.patch("/api/trust-provider-contacts/:id/contact/email", requireAuth, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const emailSchema = z.object({
        email: z.string().email("Valid email is required").nullable(),
      });

      const parsed = emailSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid email", errors: parsed.error.errors });
      }

      const { email } = parsed.data;
      const result = await storage.trustProviderContacts.updateContactEmail(id, email);

      if (!result) {
        return res.status(404).json({ message: "Provider contact not found" });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to update contact email" });
    }
  });

  // PATCH /api/trust-provider-contacts/:id/contact/name - Update contact name components (requires admin policy)
  app.patch("/api/trust-provider-contacts/:id/contact/name", requireAuth, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const nameSchema = z.object({
        title: z.string().optional(),
        given: z.string().optional(),
        middle: z.string().optional(),
        family: z.string().optional(),
        generational: z.string().optional(),
        credentials: z.string().optional(),
      });

      const parsed = nameSchema.safeParse(req.body);
      if (!parsed.success) {
        return res.status(400).json({ message: "Invalid name data", errors: parsed.error.errors });
      }

      const result = await storage.trustProviderContacts.updateContactName(id, parsed.data);

      if (!result) {
        return res.status(404).json({ message: "Provider contact not found" });
      }

      res.json(result);
    } catch (error) {
      res.status(500).json({ message: "Failed to update contact name" });
    }
  });

  // DELETE /api/trust-provider-contacts/:id - Delete a provider contact (requires admin policy)
  app.delete("/api/trust-provider-contacts/:id", requireAuth, requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.trustProviderContacts.delete(id);

      if (!deleted) {
        return res.status(404).json({ message: "Provider contact not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete provider contact" });
    }
  });
}

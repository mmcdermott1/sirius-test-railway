import type { Express, Request, Response, NextFunction } from "express";
import { storage } from "../storage";
import { insertWizardSchema } from "@shared/schema";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (permissionKey: string) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerWizardRoutes(
  app: Express, 
  requireAuth: AuthMiddleware, 
  requirePermission: PermissionMiddleware
) {
  app.get("/api/wizards", requireAccess(policies.admin), async (req, res) => {
    try {
      const { type, status, entityId } = req.query;
      
      const filters: { type?: string; status?: string; entityId?: string } = {};
      if (type) filters.type = type as string;
      if (status) filters.status = status as string;
      if (entityId) filters.entityId = entityId as string;

      const wizards = await storage.wizards.list(filters);
      res.json(wizards);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch wizards" });
    }
  });

  app.get("/api/wizards/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      const wizard = await storage.wizards.getById(id);
      
      if (!wizard) {
        return res.status(404).json({ message: "Wizard not found" });
      }

      res.json(wizard);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch wizard" });
    }
  });

  app.post("/api/wizards", requireAccess(policies.admin), async (req, res) => {
    try {
      const validatedData = insertWizardSchema.parse(req.body);
      const wizard = await storage.wizards.create(validatedData);
      res.status(201).json(wizard);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid wizard data", error });
      } else {
        res.status(500).json({ message: "Failed to create wizard" });
      }
    }
  });

  app.patch("/api/wizards/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.wizards.getById(id);
      if (!existing) {
        return res.status(404).json({ message: "Wizard not found" });
      }

      const validatedData = insertWizardSchema.partial().parse(req.body);
      const wizard = await storage.wizards.update(id, validatedData);
      res.json(wizard);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid wizard data", error });
      } else {
        res.status(500).json({ message: "Failed to update wizard" });
      }
    }
  });

  app.delete("/api/wizards/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const { id } = req.params;
      
      const existing = await storage.wizards.getById(id);
      if (!existing) {
        return res.status(404).json({ message: "Wizard not found" });
      }

      const success = await storage.wizards.delete(id);
      if (!success) {
        return res.status(404).json({ message: "Wizard not found" });
      }

      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete wizard" });
    }
  });
}

import type { Express } from "express";
import { storage } from "../storage";
import { z } from "zod";
import { requireAccess } from '../accessControl';
import * as policies from '../policies';

const logsQuerySchema = z.object({
  page: z.string().regex(/^\d+$/).transform(Number).optional().default("1"),
  limit: z.string().regex(/^\d+$/).transform(Number).optional().default("50"),
  module: z.string().optional(),
  operation: z.string().optional(),
  search: z.string().optional(),
});

export function registerLogRoutes(app: Express) {
  app.get("/api/logs", requireAccess(policies.admin), async (req, res) => {
    try {
      const params = logsQuerySchema.parse(req.query);
      const result = await storage.logs.getLogs({
        page: params.page,
        limit: params.limit,
        module: params.module,
        operation: params.operation,
        search: params.search,
      });

      res.json(result);
    } catch (error) {
      console.error("Error fetching logs:", error);
      res.status(500).json({ 
        error: "Failed to fetch logs",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get unique modules and operations for filter dropdowns
  app.get("/api/logs/filters", requireAccess(policies.admin), async (req, res) => {
    try {
      const filters = await storage.logs.getLogFilters();
      res.json(filters);
    } catch (error) {
      console.error("Error fetching log filters:", error);
      res.status(500).json({ 
        error: "Failed to fetch log filters",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });

  // Get a single log by ID
  app.get("/api/logs/:id", requireAccess(policies.admin), async (req, res) => {
    try {
      const id = parseInt(req.params.id);
      if (isNaN(id)) {
        return res.status(400).json({ error: "Invalid log ID" });
      }

      const log = await storage.logs.getLogById(id);

      if (!log) {
        return res.status(404).json({ error: "Log not found" });
      }

      res.json(log);
    } catch (error) {
      console.error("Error fetching log:", error);
      res.status(500).json({ 
        error: "Failed to fetch log",
        details: error instanceof Error ? error.message : "Unknown error"
      });
    }
  });
}

import type { Express } from "express";
import { createServer, type Server } from "http";
import { storage } from "./storage";
import { insertWorkerSchema } from "@shared/schema";

export async function registerRoutes(app: Express): Promise<Server> {
  // Worker routes
  
  // GET /api/workers - Get all workers
  app.get("/api/workers", async (req, res) => {
    try {
      const workers = await storage.getAllWorkers();
      res.json(workers);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch workers" });
    }
  });

  // POST /api/workers - Create a new worker
  app.post("/api/workers", async (req, res) => {
    try {
      const validatedData = insertWorkerSchema.parse(req.body);
      const worker = await storage.createWorker(validatedData);
      res.status(201).json(worker);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid worker data" });
      } else {
        res.status(500).json({ message: "Failed to create worker" });
      }
    }
  });

  // PUT /api/workers/:id - Update a worker
  app.put("/api/workers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const validatedData = insertWorkerSchema.partial().parse(req.body);
      const worker = await storage.updateWorker(id, validatedData);
      
      if (!worker) {
        res.status(404).json({ message: "Worker not found" });
        return;
      }
      
      res.json(worker);
    } catch (error) {
      if (error instanceof Error && error.name === "ZodError") {
        res.status(400).json({ message: "Invalid worker data" });
      } else {
        res.status(500).json({ message: "Failed to update worker" });
      }
    }
  });

  // DELETE /api/workers/:id - Delete a worker
  app.delete("/api/workers/:id", async (req, res) => {
    try {
      const { id } = req.params;
      const deleted = await storage.deleteWorker(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Worker not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete worker" });
    }
  });

  const httpServer = createServer(app);
  return httpServer;
}

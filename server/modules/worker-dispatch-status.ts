import { Router, Request, Response } from "express";
import { insertWorkerDispatchStatusSchema } from "@shared/schema";
import { createWorkerDispatchStatusStorage, workerDispatchStatusLoggingConfig } from "../storage/worker-dispatch-status";
import { withStorageLogging } from "../storage/middleware/logging";
import { z } from "zod";

const router = Router();

const storage = withStorageLogging(
  createWorkerDispatchStatusStorage(),
  workerDispatchStatusLoggingConfig
);

router.get("/worker/:workerId", async (req: Request, res: Response) => {
  try {
    const status = await storage.getByWorker(req.params.workerId);
    if (!status) {
      return res.status(404).json({ error: "Worker dispatch status not found" });
    }
    res.json(status);
  } catch (error) {
    console.error("Error fetching worker dispatch status:", error);
    res.status(500).json({ error: "Failed to fetch worker dispatch status" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const status = await storage.get(req.params.id);
    if (!status) {
      return res.status(404).json({ error: "Worker dispatch status not found" });
    }
    res.json(status);
  } catch (error) {
    console.error("Error fetching worker dispatch status:", error);
    res.status(500).json({ error: "Failed to fetch worker dispatch status" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const validated = insertWorkerDispatchStatusSchema.parse(req.body);
    const status = await storage.create(validated);
    res.status(201).json(status);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    console.error("Error creating worker dispatch status:", error);
    res.status(500).json({ error: "Failed to create worker dispatch status" });
  }
});

router.put("/worker/:workerId", async (req: Request, res: Response) => {
  try {
    const validated = insertWorkerDispatchStatusSchema.partial().parse(req.body);
    const status = await storage.upsertByWorker(req.params.workerId, validated);
    res.json(status);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    console.error("Error updating worker dispatch status:", error);
    res.status(500).json({ error: "Failed to update worker dispatch status" });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const validated = insertWorkerDispatchStatusSchema.partial().parse(req.body);
    const status = await storage.update(req.params.id, validated);
    if (!status) {
      return res.status(404).json({ error: "Worker dispatch status not found" });
    }
    res.json(status);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    console.error("Error updating worker dispatch status:", error);
    res.status(500).json({ error: "Failed to update worker dispatch status" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const deleted = await storage.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "Worker dispatch status not found" });
    }
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting worker dispatch status:", error);
    res.status(500).json({ error: "Failed to delete worker dispatch status" });
  }
});

export default router;

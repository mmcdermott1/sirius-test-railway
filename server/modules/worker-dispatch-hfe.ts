import { Router, Request, Response } from "express";
import { insertWorkerDispatchHfeSchema } from "@shared/schema";
import { createWorkerDispatchHfeStorage, workerDispatchHfeLoggingConfig } from "../storage/worker-dispatch-hfe";
import { withStorageLogging } from "../storage/middleware/logging";
import { z } from "zod";
import { db } from "../db";
import { employers } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

const router = Router();

const storage = withStorageLogging(
  createWorkerDispatchHfeStorage(),
  workerDispatchHfeLoggingConfig
);

async function enrichWithEmployer(entries: any[]) {
  if (entries.length === 0) return entries;
  
  const employerIds = Array.from(new Set(entries.map(e => e.employerId)));
  const employerRecords = await db
    .select({ id: employers.id, name: employers.name })
    .from(employers)
    .where(inArray(employers.id, employerIds));
  
  const employerMap = new Map(employerRecords.map(e => [e.id, e]));
  
  return entries.map(entry => ({
    ...entry,
    employer: employerMap.get(entry.employerId) || null
  }));
}

router.get("/worker/:workerId", async (req: Request, res: Response) => {
  try {
    const entries = await storage.getByWorker(req.params.workerId);
    const enriched = await enrichWithEmployer(entries);
    res.json(enriched);
  } catch (error) {
    console.error("Error fetching worker HFE entries:", error);
    res.status(500).json({ error: "Failed to fetch HFE entries" });
  }
});

router.get("/employer/:employerId", async (req: Request, res: Response) => {
  try {
    const entries = await storage.getByEmployer(req.params.employerId);
    const enriched = await enrichWithEmployer(entries);
    res.json(enriched);
  } catch (error) {
    console.error("Error fetching employer HFE entries:", error);
    res.status(500).json({ error: "Failed to fetch HFE entries" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const entry = await storage.get(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: "HFE entry not found" });
    }
    const [enriched] = await enrichWithEmployer([entry]);
    res.json(enriched);
  } catch (error) {
    console.error("Error fetching HFE entry:", error);
    res.status(500).json({ error: "Failed to fetch HFE entry" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const validated = insertWorkerDispatchHfeSchema.parse(req.body);
    const entry = await storage.create(validated);
    const [enriched] = await enrichWithEmployer([entry]);
    res.status(201).json(enriched);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    console.error("Error creating HFE entry:", error);
    res.status(500).json({ error: "Failed to create HFE entry" });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const validated = insertWorkerDispatchHfeSchema.partial().parse(req.body);
    const entry = await storage.update(req.params.id, validated);
    if (!entry) {
      return res.status(404).json({ error: "HFE entry not found" });
    }
    const [enriched] = await enrichWithEmployer([entry]);
    res.json(enriched);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    console.error("Error updating HFE entry:", error);
    res.status(500).json({ error: "Failed to update HFE entry" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const deleted = await storage.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "HFE entry not found" });
    }
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting HFE entry:", error);
    res.status(500).json({ error: "Failed to delete HFE entry" });
  }
});

export default router;

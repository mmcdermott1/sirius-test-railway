import { Router, Request, Response } from "express";
import { insertDispatchWorkerDncSchema } from "@shared/schema";
import { createDispatchWorkerDncStorage, dispatchWorkerDncLoggingConfig } from "../storage/dispatch-worker-dnc";
import { withStorageLogging } from "../storage/middleware/logging";
import { z } from "zod";
import { db } from "../db";
import { employers } from "@shared/schema";
import { eq, inArray } from "drizzle-orm";

const router = Router();

const storage = withStorageLogging(
  createDispatchWorkerDncStorage(),
  dispatchWorkerDncLoggingConfig
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
    console.error("Error fetching worker DNC entries:", error);
    res.status(500).json({ error: "Failed to fetch DNC entries" });
  }
});

router.get("/employer/:employerId", async (req: Request, res: Response) => {
  try {
    const entries = await storage.getByEmployer(req.params.employerId);
    const enriched = await enrichWithEmployer(entries);
    res.json(enriched);
  } catch (error) {
    console.error("Error fetching employer DNC entries:", error);
    res.status(500).json({ error: "Failed to fetch DNC entries" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const entry = await storage.get(req.params.id);
    if (!entry) {
      return res.status(404).json({ error: "DNC entry not found" });
    }
    const [enriched] = await enrichWithEmployer([entry]);
    res.json(enriched);
  } catch (error) {
    console.error("Error fetching DNC entry:", error);
    res.status(500).json({ error: "Failed to fetch DNC entry" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const validated = insertDispatchWorkerDncSchema.parse(req.body);
    const entry = await storage.create(validated);
    const [enriched] = await enrichWithEmployer([entry]);
    res.status(201).json(enriched);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    console.error("Error creating DNC entry:", error);
    res.status(500).json({ error: "Failed to create DNC entry" });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const validated = insertDispatchWorkerDncSchema.partial().parse(req.body);
    const entry = await storage.update(req.params.id, validated);
    if (!entry) {
      return res.status(404).json({ error: "DNC entry not found" });
    }
    const [enriched] = await enrichWithEmployer([entry]);
    res.json(enriched);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    console.error("Error updating DNC entry:", error);
    res.status(500).json({ error: "Failed to update DNC entry" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const deleted = await storage.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "DNC entry not found" });
    }
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting DNC entry:", error);
    res.status(500).json({ error: "Failed to delete DNC entry" });
  }
});

export default router;

import { Router, Request, Response } from "express";
import { insertWorkerBanSchema } from "@shared/schema";
import { storage } from "../storage";
import { z } from "zod";

const router = Router();

router.get("/worker/:workerId", async (req: Request, res: Response) => {
  try {
    const bans = await storage.workerBans.getByWorker(req.params.workerId);
    res.json(bans);
  } catch (error) {
    console.error("Error fetching worker bans:", error);
    res.status(500).json({ error: "Failed to fetch worker bans" });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const ban = await storage.workerBans.get(req.params.id);
    if (!ban) {
      return res.status(404).json({ error: "Worker ban not found" });
    }
    res.json(ban);
  } catch (error) {
    console.error("Error fetching worker ban:", error);
    res.status(500).json({ error: "Failed to fetch worker ban" });
  }
});

router.post("/", async (req: Request, res: Response) => {
  try {
    const validated = insertWorkerBanSchema.parse(req.body);
    const ban = await storage.workerBans.create(validated);
    res.status(201).json(ban);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    console.error("Error creating worker ban:", error);
    res.status(500).json({ error: "Failed to create worker ban" });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const validated = insertWorkerBanSchema.partial().parse(req.body);
    const ban = await storage.workerBans.update(req.params.id, validated);
    if (!ban) {
      return res.status(404).json({ error: "Worker ban not found" });
    }
    res.json(ban);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    console.error("Error updating worker ban:", error);
    res.status(500).json({ error: "Failed to update worker ban" });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const deleted = await storage.workerBans.delete(req.params.id);
    if (!deleted) {
      return res.status(404).json({ error: "Worker ban not found" });
    }
    res.status(204).send();
  } catch (error) {
    console.error("Error deleting worker ban:", error);
    res.status(500).json({ error: "Failed to delete worker ban" });
  }
});

export default router;

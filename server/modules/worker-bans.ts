import { Router, Request, Response } from "express";
import { insertWorkerBanSchema, workerBanTypeEnum } from "@shared/schema";
import { storage } from "../storage";
import { z } from "zod";

const router = Router();

const createWorkerBanApiSchema = z.object({
  workerId: z.string(),
  type: z.enum(workerBanTypeEnum).optional().nullable(),
  startDate: z.coerce.date(),
  endDate: z.coerce.date().nullable().optional(),
  message: z.string().nullable().optional(),
});

const updateWorkerBanApiSchema = z.object({
  type: z.enum(workerBanTypeEnum).optional().nullable(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().nullable().optional(),
  message: z.string().nullable().optional(),
});

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
    const validated = createWorkerBanApiSchema.parse(req.body);
    const ban = await storage.workerBans.create({
      workerId: validated.workerId,
      type: validated.type ?? null,
      startDate: validated.startDate,
      endDate: validated.endDate ?? null,
      message: validated.message ?? null,
    });
    res.status(201).json(ban);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    if (error instanceof Error) {
      console.error("Error creating worker ban:", error.message);
      return res.status(400).json({ error: error.message });
    }
    console.error("Error creating worker ban:", error);
    res.status(500).json({ error: "Failed to create worker ban" });
  }
});

router.put("/:id", async (req: Request, res: Response) => {
  try {
    const validated = updateWorkerBanApiSchema.parse(req.body);
    const updateData: Record<string, any> = {};
    
    if (validated.type !== undefined) updateData.type = validated.type;
    if (validated.startDate !== undefined) updateData.startDate = validated.startDate;
    if (validated.endDate !== undefined) updateData.endDate = validated.endDate ?? null;
    if (validated.message !== undefined) updateData.message = validated.message;
    
    const ban = await storage.workerBans.update(req.params.id, updateData);
    if (!ban) {
      return res.status(404).json({ error: "Worker ban not found" });
    }
    res.json(ban);
  } catch (error) {
    if (error instanceof z.ZodError) {
      return res.status(400).json({ error: "Invalid data", details: error.errors });
    }
    if (error instanceof Error) {
      console.error("Error updating worker ban:", error.message);
      return res.status(400).json({ error: error.message });
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

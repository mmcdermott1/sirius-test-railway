import type { Express } from "express";
import { storage } from "../storage";
import { insertEventSchema, insertEventOccurrenceSchema } from "@shared/schema";
import { requireAccess } from "../accessControl";
import { policies } from "../policies";

export function registerEventsRoutes(
  app: Express,
  requireAuth: any,
  requirePermission: any
) {
  const eventAccess = policies.admin.requireComponent("event");

  app.get("/api/events", requireAccess(eventAccess), async (req, res) => {
    try {
      const events = await storage.events.getAll();
      res.json(events);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch events" });
    }
  });

  app.get("/api/events/:id", requireAccess(eventAccess), async (req, res) => {
    try {
      const { id } = req.params;
      const event = await storage.events.get(id);
      
      if (!event) {
        res.status(404).json({ message: "Event not found" });
        return;
      }
      
      const occurrences = await storage.eventOccurrences.getAll(id);
      
      res.json({ ...event, occurrences });
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch event" });
    }
  });

  app.post("/api/events", requireAccess(eventAccess), async (req, res) => {
    try {
      const validation = insertEventSchema.safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: validation.error.errors 
        });
      }
      
      const event = await storage.events.create(validation.data);
      res.status(201).json(event);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create event" });
    }
  });

  app.put("/api/events/:id", requireAccess(eventAccess), async (req, res) => {
    try {
      const { id } = req.params;
      const validation = insertEventSchema.partial().safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid request data",
          errors: validation.error.errors 
        });
      }
      
      const event = await storage.events.update(id, validation.data);
      
      if (!event) {
        res.status(404).json({ message: "Event not found" });
        return;
      }
      
      res.json(event);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update event" });
    }
  });

  app.delete("/api/events/:id", requireAccess(eventAccess), async (req, res) => {
    try {
      const { id } = req.params;
      await storage.eventOccurrences.deleteByEventId(id);
      const deleted = await storage.events.delete(id);
      
      if (!deleted) {
        res.status(404).json({ message: "Event not found" });
        return;
      }
      
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete event" });
    }
  });

  app.get("/api/events/:id/occurrences", requireAccess(eventAccess), async (req, res) => {
    try {
      const { id } = req.params;
      const event = await storage.events.get(id);
      
      if (!event) {
        res.status(404).json({ message: "Event not found" });
        return;
      }
      
      const occurrences = await storage.eventOccurrences.getAll(id);
      res.json(occurrences);
    } catch (error) {
      res.status(500).json({ message: "Failed to fetch occurrences" });
    }
  });

  app.post("/api/events/:id/occurrences", requireAccess(eventAccess), async (req, res) => {
    try {
      const { id } = req.params;
      const event = await storage.events.get(id);
      
      if (!event) {
        res.status(404).json({ message: "Event not found" });
        return;
      }

      if (Array.isArray(req.body)) {
        const occurrences = req.body.map((occ: any) => ({
          ...occ,
          eventId: id,
        }));
        
        for (const occ of occurrences) {
          const validation = insertEventOccurrenceSchema.safeParse(occ);
          if (!validation.success) {
            return res.status(400).json({ 
              message: "Invalid occurrence data",
              errors: validation.error.errors 
            });
          }
        }
        
        const created = await storage.eventOccurrences.createMany(occurrences);
        res.status(201).json(created);
      } else {
        const occurrenceData = { ...req.body, eventId: id };
        const validation = insertEventOccurrenceSchema.safeParse(occurrenceData);
        
        if (!validation.success) {
          return res.status(400).json({ 
            message: "Invalid occurrence data",
            errors: validation.error.errors 
          });
        }
        
        const occurrence = await storage.eventOccurrences.create(validation.data);
        res.status(201).json(occurrence);
      }
    } catch (error: any) {
      res.status(500).json({ message: "Failed to create occurrence" });
    }
  });

  app.put("/api/events/:eventId/occurrences/:occId", requireAccess(eventAccess), async (req, res) => {
    try {
      const { eventId, occId } = req.params;
      
      const event = await storage.events.get(eventId);
      if (!event) {
        res.status(404).json({ message: "Event not found" });
        return;
      }
      
      const existing = await storage.eventOccurrences.get(occId);
      if (!existing || existing.eventId !== eventId) {
        res.status(404).json({ message: "Occurrence not found" });
        return;
      }
      
      const validation = insertEventOccurrenceSchema.partial().safeParse(req.body);
      
      if (!validation.success) {
        return res.status(400).json({ 
          message: "Invalid occurrence data",
          errors: validation.error.errors 
        });
      }
      
      const occurrence = await storage.eventOccurrences.update(occId, validation.data);
      res.json(occurrence);
    } catch (error: any) {
      res.status(500).json({ message: "Failed to update occurrence" });
    }
  });

  app.delete("/api/events/:eventId/occurrences/:occId", requireAccess(eventAccess), async (req, res) => {
    try {
      const { eventId, occId } = req.params;
      
      const event = await storage.events.get(eventId);
      if (!event) {
        res.status(404).json({ message: "Event not found" });
        return;
      }
      
      const existing = await storage.eventOccurrences.get(occId);
      if (!existing || existing.eventId !== eventId) {
        res.status(404).json({ message: "Occurrence not found" });
        return;
      }
      
      await storage.eventOccurrences.delete(occId);
      res.status(204).send();
    } catch (error) {
      res.status(500).json({ message: "Failed to delete occurrence" });
    }
  });
}

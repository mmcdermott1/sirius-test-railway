import type { Express, Request, Response, NextFunction } from "express";
import {
  entityMetadataStorage,
  isRecordId,
} from "../storage/system/entity-metadata";
import { logger } from "../logger";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

/**
 * Reading a record's provenance.
 *
 * There is one endpoint here and it only reads. Provenance is written by the
 * mutation that caused it — the storage logging middleware stamps it after the
 * transaction commits — and by nothing else, so no create, update or delete
 * route belongs in this file. Anything that wants a record's history changed
 * has to change the record.
 *
 * Access is deliberately shallow: any signed-in person may ask about any
 * record whose id they hold. What comes back says when a record was touched
 * and by whom, never what it says, so there is nothing here to gate on the
 * record's own permissions — and gating it would mean teaching this endpoint
 * every kind of record in the system.
 */
export function registerEntityMetadataRoutes(app: Express, requireAuth: AuthMiddleware) {
  app.get("/api/entity-metadata/:entityId", requireAuth, async (req: Request, res: Response) => {
    const { entityId } = req.params;
    if (!isRecordId(entityId)) {
      return res.status(400).json({ message: "Not a record id" });
    }

    try {
      const metadata = await entityMetadataStorage.get(entityId);
      // A record with nothing recorded is an ordinary answer, not a failure:
      // every record that predates this framework reads this way until
      // something touches it.
      res.json({ metadata: metadata ?? null });
    } catch (error) {
      logger.error("Failed to read entity metadata", {
        service: "entityMetadata",
        entityId,
        error: error instanceof Error ? error.message : String(error),
      });
      res.status(500).json({ message: "Failed to read record metadata" });
    }
  });
}

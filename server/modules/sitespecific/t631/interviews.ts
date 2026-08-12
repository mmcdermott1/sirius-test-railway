import type { Express, Request, Response, NextFunction } from "express";
import { requireComponent } from "../../components";
import { storage } from "../../../storage";
import { insertSitespecificT631JobInterviewSchema } from "../../../../shared/schema/sitespecific/t631/interviews-schema";

type AuthMiddleware = (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type PermissionMiddleware = (
  permissionKey: string,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;
type AccessMiddleware = (
  policyId: string,
) => (req: Request, res: Response, next: NextFunction) => void | Promise<any>;

export function registerT631InterviewsRoutes(
  app: Express,
  requireAuth: AuthMiddleware,
  _requirePermission: PermissionMiddleware,
  requireAccess: AccessMiddleware,
) {
  const interviewsStorage = storage.t631Interviews;
  const componentMiddleware = requireComponent("sitespecific.t631.interviews");
  // Same policy the core dispatch admin routes use (see modules/dispatch/*).
  const adminGate = requireAccess("admin");

  const tableUnavailable = (res: Response) =>
    res.status(503).json({
      message:
        "T631 job interviews table does not exist. Please enable the Teamsters 631 Interviews component first.",
    });

  app.get(
    "/api/sitespecific/t631/interviews",
    requireAuth,
    componentMiddleware,
    adminGate,
    async (req, res) => {
      try {
        if (!(await interviewsStorage.tableExists())) return tableUnavailable(res);
        const { workerId, jobId } = req.query as { workerId?: string; jobId?: string };
        if (workerId) return res.json(await interviewsStorage.getByWorker(workerId));
        if (jobId) return res.json(await interviewsStorage.getByJob(jobId));
        return res
          .status(400)
          .json({ message: "Provide a workerId or jobId query parameter" });
      } catch (error) {
        console.error("Failed to fetch T631 interviews:", error);
        res.status(500).json({ message: "Failed to fetch interviews" });
      }
    },
  );

  app.get(
    "/api/sitespecific/t631/interviews/:id",
    requireAuth,
    componentMiddleware,
    adminGate,
    async (req, res) => {
      try {
        if (!(await interviewsStorage.tableExists())) return tableUnavailable(res);
        const record = await interviewsStorage.get(req.params.id);
        if (!record) return res.status(404).json({ message: "Interview not found" });
        res.json(record);
      } catch (error) {
        console.error("Failed to fetch T631 interview:", error);
        res.status(500).json({ message: "Failed to fetch interview" });
      }
    },
  );

  app.post(
    "/api/sitespecific/t631/interviews",
    requireAuth,
    componentMiddleware,
    adminGate,
    async (req, res) => {
      try {
        if (!(await interviewsStorage.tableExists())) return tableUnavailable(res);
        const parsed = insertSitespecificT631JobInterviewSchema.parse(req.body);
        const record = await interviewsStorage.create(parsed);
        res.status(201).json(record);
      } catch (error: any) {
        if (error?.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        if (error?.code === "23505") {
          return res
            .status(409)
            .json({ message: "This worker already has an interview for this job" });
        }
        if (error?.code === "23503") {
          return res
            .status(400)
            .json({ message: "Worker or dispatch job does not exist" });
        }
        console.error("Failed to create T631 interview:", error);
        res.status(500).json({ message: "Failed to create interview" });
      }
    },
  );

  app.patch(
    "/api/sitespecific/t631/interviews/:id",
    requireAuth,
    componentMiddleware,
    adminGate,
    async (req, res) => {
      try {
        if (!(await interviewsStorage.tableExists())) return tableUnavailable(res);
        // worker/job are immutable after creation: an interview belongs to one
        // [job, worker] pair; re-pointing it would silently rewrite history.
        const parsed = insertSitespecificT631JobInterviewSchema
          .partial()
          .omit({ workerId: true, jobId: true })
          .parse(req.body);
        const record = await interviewsStorage.update(req.params.id, parsed);
        if (!record) return res.status(404).json({ message: "Interview not found" });
        res.json(record);
      } catch (error: any) {
        if (error?.name === "ZodError") {
          return res.status(400).json({ message: "Invalid data", errors: error.errors });
        }
        console.error("Failed to update T631 interview:", error);
        res.status(500).json({ message: "Failed to update interview" });
      }
    },
  );

  app.delete(
    "/api/sitespecific/t631/interviews/:id",
    requireAuth,
    componentMiddleware,
    adminGate,
    async (req, res) => {
      try {
        if (!(await interviewsStorage.tableExists())) return tableUnavailable(res);
        const deleted = await interviewsStorage.delete(req.params.id);
        if (!deleted) return res.status(404).json({ message: "Interview not found" });
        res.status(204).end();
      } catch (error) {
        console.error("Failed to delete T631 interview:", error);
        res.status(500).json({ message: "Failed to delete interview" });
      }
    },
  );
}

import { Router } from "express";

export const contractsRouter = Router();

contractsRouter.get("/meta", (_req, res) => {
  res.json({
    name: "SkladPro API contract",
    version: "2026-04-15",
    format: "openapi-3.1-lite",
    endpoints: {
      health: "/api/health",
      authMe: "/api/auth/me",
      stocks: "/api/stocks",
      issues: "/api/issues",
      operations: "/api/operations",
      documents: "/api/documents",
      materialMerge: "/api/materials/merge",
      integrationJobs: "/api/integrations/jobs",
      notifications: "/api/notifications"
    }
  });
});

contractsRouter.get("/openapi.json", (_req, res) => {
  res.json({
    openapi: "3.1.0",
    info: { title: "SkladPro API", version: "2026-04-15" },
    paths: {
      "/api/integrations/jobs": {
        get: { summary: "List integration jobs" },
        post: { summary: "Create integration job" }
      },
      "/api/integrations/jobs/{id}/run": {
        patch: { summary: "Run integration job" }
      },
      "/api/notifications": {
        get: { summary: "List notifications for current user" }
      },
      "/api/notifications/read": {
        patch: { summary: "Mark notifications as read" }
      }
    }
  });
});

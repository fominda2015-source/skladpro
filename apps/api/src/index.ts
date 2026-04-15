import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import path from "node:path";
import { prisma } from "./lib/prisma.js";
import { config } from "./config.js";
import { adminRouter } from "./routes/admin.js";
import { authRouter } from "./routes/auth.js";
import { auditRouter } from "./routes/audit.js";
import { dashboardRouter } from "./routes/dashboard.js";
import { contractsRouter } from "./routes/contracts.js";
import { documentsRouter } from "./routes/documents.js";
import { integrationsRouter } from "./routes/integrations.js";
import { issueRequestsRouter } from "./routes/issueRequests.js";
import { materialMatchRouter } from "./routes/materialMatch.js";
import { materialsRouter } from "./routes/materials.js";
import { operationsRouter } from "./routes/operations.js";
import { projectsRouter } from "./routes/projects.js";
import { projectLimitsRouter } from "./routes/projectLimits.js";
import { stockMovementsRouter } from "./routes/stockMovements.js";
import { stocksRouter } from "./routes/stocks.js";
import { notificationsRouter } from "./routes/notifications.js";
import { transportWaybillsRouter } from "./routes/transportWaybills.js";
import { toolsRouter } from "./routes/tools.js";
import { teamRouter } from "./routes/team.js";
import { warehousesRouter } from "./routes/warehouses.js";
import { seedBaseData } from "./seed.js";

dotenv.config();

const app = express();
const port = config.port;

app.use(cors());
app.use(express.json());
app.use(`/${config.uploadsDir}`, express.static(path.resolve(process.cwd(), config.uploadsDir)));

app.get("/api/health", (_req, res) => {
  res.json({
    ok: true,
    service: "skladpro-api",
    ts: new Date().toISOString()
  });
});

app.get("/api/health/db", async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({ ok: true, db: "connected" });
  } catch (error) {
    res.status(500).json({ ok: false, db: "disconnected", error: String(error) });
  }
});

app.get("/api/catalog/materials", async (_req, res) => {
  const materials = await prisma.material.findMany({
    orderBy: { createdAt: "desc" },
    take: 50
  });
  res.json(materials);
});

app.use("/api/auth", authRouter);
app.use("/api/admin", adminRouter);
app.use("/api/issues", issueRequestsRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/project-limits", projectLimitsRouter);
app.use("/api/warehouses", warehousesRouter);
app.use("/api/materials", materialsRouter);
app.use("/api/operations", operationsRouter);
app.use("/api/stocks", stocksRouter);
app.use("/api/stock-movements", stockMovementsRouter);
app.use("/api/documents", documentsRouter);
app.use("/api/tools", toolsRouter);
app.use("/api/waybills", transportWaybillsRouter);
app.use("/api/material-match", materialMatchRouter);
app.use("/api/audit", auditRouter);
app.use("/api/dashboard", dashboardRouter);
app.use("/api/integrations", integrationsRouter);
app.use("/api/notifications", notificationsRouter);
app.use("/api/team", teamRouter);
app.use("/api/contracts", contractsRouter);

async function start() {
  await seedBaseData();
  app.listen(port, "0.0.0.0", () => {
    console.log(`API running on http://0.0.0.0:${port}`);
  });
}

void start();

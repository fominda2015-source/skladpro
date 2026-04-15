import { Router } from "express";
import path from "node:path";
import PDFDocument from "pdfkit";
import { prisma } from "../lib/prisma.js";
import { requireAuth, requirePermission, type AuthedRequest } from "../middleware/auth.js";
import { getRequestDataScope, projectWhereFromScope } from "../lib/dataScope.js";

export const reportsRouter = Router();
reportsRouter.use(requireAuth);
reportsRouter.use(requirePermission("dashboard.read"));

reportsRouter.get("/object/:projectId/summary.pdf", async (req: AuthedRequest, res) => {
  const projectId = String(req.params.projectId);
  const scope = await getRequestDataScope(req);
  const project = await prisma.project.findFirst({
    where: {
      AND: [
        projectWhereFromScope(scope),
        { id: projectId }
      ]
    },
    include: {
      warehouseLinks: { include: { warehouse: true } }
    }
  });
  if (!project) return res.status(404).json({ error: "Project not found" });

  const warehouseIds = project.warehouseLinks.map((x) => x.warehouseId);
  const [issuesCount, openWaybillsCount, toolsCount, stockRows] = await Promise.all([
    prisma.issueRequest.count({ where: { projectId } }),
    prisma.transportWaybill.count({
      where: { issueRequest: { projectId }, status: { in: ["DRAFT", "FORMED", "SHIPPED", "RECEIVED"] } }
    }),
    prisma.tool.count({ where: { projectId } }),
    warehouseIds.length
      ? prisma.stock.findMany({
          where: { warehouseId: { in: warehouseIds } },
          include: { material: true, warehouse: true },
          orderBy: [{ warehouseId: "asc" }],
          take: 300
        })
      : Promise.resolve([])
  ]);

  res.setHeader("Content-Type", "application/pdf");
  res.setHeader(
    "Content-Disposition",
    `attachment; filename=object-summary-${project.code || project.id}.pdf`
  );
  const fontPath = path.resolve(process.cwd(), "node_modules/dejavu-fonts-ttf/ttf/DejaVuSans.ttf");
  const doc = new PDFDocument({ size: "A4", margin: 28 });
  doc.pipe(res);
  doc.font(fontPath);
  doc.fontSize(18).text(`Сводка по объекту: ${project.name}`, { align: "center" });
  doc.moveDown(0.4);
  doc.fontSize(10).text(`Код: ${project.code || "-"}`, { align: "center" });
  doc.moveDown(0.8);
  doc.fontSize(12).text("Ключевые показатели");
  doc.fontSize(10).text(`Заявок: ${issuesCount}`);
  doc.fontSize(10).text(`Открытых ТН: ${openWaybillsCount}`);
  doc.fontSize(10).text(`Инструментов на объекте: ${toolsCount}`);
  doc.moveDown(0.7);
  doc.fontSize(12).text("Привязанные склады");
  if (!project.warehouseLinks.length) {
    doc.fontSize(10).text("Склады к объекту не привязаны.");
  } else {
    for (const w of project.warehouseLinks) {
      doc.fontSize(10).text(`- ${w.warehouse.name}`);
    }
  }
  doc.moveDown(0.7);
  doc.fontSize(12).text("Остатки по складам объекта (первые 300 строк)");
  if (!stockRows.length) {
    doc.fontSize(10).text("Нет данных по остаткам.");
  } else {
    stockRows.forEach((s, idx) => {
      doc
        .fontSize(9)
        .text(
          `${idx + 1}. ${s.warehouse.name} | ${s.material.name} (${s.material.unit}) | Кол-во: ${s.quantity} | Резерв: ${s.reserved}`
        );
    });
  }
  doc.end();
});

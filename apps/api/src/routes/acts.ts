import fs from "node:fs";
import path from "node:path";
import { Router } from "express";
import multer from "multer";
import { ensureActsStorage } from "../lib/actsStorage.js";
import { requireAuth, requirePermission } from "../middleware/auth.js";

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => {
    cb(null, ensureActsStorage());
  },
  filename: (_req, file, cb) => {
    const safe = path.basename(file.originalname).replace(/[^\w.\-()а-яА-ЯёЁ\s]/gi, "_");
    cb(null, safe.endsWith(".xlsx") || safe.endsWith(".xls") ? safe : `${safe}.xlsx`);
  }
});

const upload = multer({
  storage,
  limits: { fileSize: 15 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (/\.(xlsx|xls)$/i.test(file.originalname)) cb(null, true);
    else cb(new Error("Only .xlsx/.xls allowed"));
  }
});

export const actsRouter = Router();
actsRouter.use(requireAuth);

actsRouter.get("/templates", async (_req, res) => {
  const actsDir = ensureActsStorage();
  const files = fs
    .readdirSync(actsDir)
    .filter((f) => /\.(xlsx|xls)$/i.test(f))
    .sort((a, b) => a.localeCompare(b, "ru"));
  return res.json(
    files.map((fileName, i) => ({
      id: `act-${i}-${fileName}`,
      fileName,
      label: fileName.replace(/\.(xlsx|xls)$/i, ""),
      description: ""
    }))
  );
});

actsRouter.post(
  "/upload",
  requirePermission("documents.write"),
  upload.single("file"),
  async (req, res) => {
    if (!req.file) {
      return res.status(400).json({ error: "Файл не передан" });
    }
    return res.status(201).json({
      fileName: req.file.filename,
      size: req.file.size
    });
  }
);

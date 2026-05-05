import dotenv from "dotenv";

dotenv.config();

const isProduction = process.env.NODE_ENV === "production";
const seedOnStart = (process.env.SEED_ON_START || "1") === "1";
const jwtSecret = process.env.JWT_SECRET || "dev-secret-change-me";
const adminPassword = process.env.SEED_ADMIN_PASSWORD || "1111";

export const config = {
  port: Number(process.env.PORT || 4000),
  isProduction,
  seedOnStart,
  jwtSecret,
  adminEmail: process.env.SEED_ADMIN_EMAIL || "admin@skladpro.local",
  adminPassword,
  adminName: process.env.SEED_ADMIN_NAME || "System Admin",
  uploadsDir: process.env.UPLOADS_DIR || "uploads",
  corsOrigins: process.env.CORS_ORIGIN
    ? process.env.CORS_ORIGIN.split(",").map((x) => x.trim()).filter(Boolean)
    : null
};

export const config = {
  port: Number(process.env.PORT || 4000),
  jwtSecret: process.env.JWT_SECRET || "dev-secret-change-me",
  adminEmail: process.env.SEED_ADMIN_EMAIL || "admin@skladpro.local",
  adminPassword: process.env.SEED_ADMIN_PASSWORD || "1111",
  adminName: process.env.SEED_ADMIN_NAME || "System Admin",
  uploadsDir: process.env.UPLOADS_DIR || "uploads"
};

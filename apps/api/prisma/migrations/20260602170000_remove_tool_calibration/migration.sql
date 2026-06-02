DROP INDEX IF EXISTS "Tool_calibrationDueAt_idx";
ALTER TABLE "Tool" DROP COLUMN IF EXISTS "calibrationDueAt";

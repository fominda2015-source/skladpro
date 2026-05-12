-- Add metadata fields for revertable audit entries.
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "summary" TEXT;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "reverted" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "revertedAt" TIMESTAMP(3);
ALTER TABLE "AuditLog" ADD COLUMN IF NOT EXISTS "revertedById" TEXT;

-- FK to user who reverted (idempotent).
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'AuditLog_revertedById_fkey'
  ) THEN
    ALTER TABLE "AuditLog"
      ADD CONSTRAINT "AuditLog_revertedById_fkey"
      FOREIGN KEY ("revertedById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "AuditLog_reverted_idx" ON "AuditLog"("reverted");

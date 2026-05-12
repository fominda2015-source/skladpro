-- AlterTable
ALTER TABLE "ReceiptRequest" ADD COLUMN IF NOT EXISTS "fromLimit" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ReceiptRequest" ADD COLUMN IF NOT EXISTS "objectLimitTemplateId" TEXT;

-- AddForeignKey
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'ReceiptRequest_objectLimitTemplateId_fkey'
  ) THEN
    ALTER TABLE "ReceiptRequest"
      ADD CONSTRAINT "ReceiptRequest_objectLimitTemplateId_fkey"
      FOREIGN KEY ("objectLimitTemplateId") REFERENCES "ObjectLimitTemplate"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END$$;

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ReceiptRequest_objectLimitTemplateId_idx" ON "ReceiptRequest"("objectLimitTemplateId");

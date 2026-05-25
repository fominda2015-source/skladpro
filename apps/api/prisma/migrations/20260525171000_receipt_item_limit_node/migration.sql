-- Add per-item limit node binding for receipt request items.
ALTER TABLE "ReceiptRequestItem"
  ADD COLUMN IF NOT EXISTS "limitNodeId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'ReceiptRequestItem_limitNodeId_fkey'
  ) THEN
    ALTER TABLE "ReceiptRequestItem"
      ADD CONSTRAINT "ReceiptRequestItem_limitNodeId_fkey"
      FOREIGN KEY ("limitNodeId") REFERENCES "ObjectLimitNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "ReceiptRequestItem_limitNodeId_idx"
  ON "ReceiptRequestItem"("limitNodeId");

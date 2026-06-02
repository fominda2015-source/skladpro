ALTER TABLE "ObjectLimitNode" ADD COLUMN IF NOT EXISTS "transferredOutQty" DECIMAL(14,3) NOT NULL DEFAULT 0;

ALTER TABLE "TransferRequest" ADD COLUMN IF NOT EXISTS "approvedById" TEXT;
ALTER TABLE "TransferRequest" ADD COLUMN IF NOT EXISTS "receivedById" TEXT;
ALTER TABLE "TransferRequest" ADD COLUMN IF NOT EXISTS "approvedAt" TIMESTAMP(3);
ALTER TABLE "TransferRequest" ADD COLUMN IF NOT EXISTS "receivedAt" TIMESTAMP(3);

ALTER TABLE "TransferRequestLine" ADD COLUMN IF NOT EXISTS "limitNodeId" TEXT;

CREATE INDEX IF NOT EXISTS "TransferRequestLine_limitNodeId_idx" ON "TransferRequestLine"("limitNodeId");

ALTER TABLE "TransferRequestLine" DROP CONSTRAINT IF EXISTS "TransferRequestLine_limitNodeId_fkey";
ALTER TABLE "TransferRequestLine" ADD CONSTRAINT "TransferRequestLine_limitNodeId_fkey" FOREIGN KEY ("limitNodeId") REFERENCES "ObjectLimitNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

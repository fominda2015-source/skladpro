ALTER TABLE "Stock" ADD COLUMN IF NOT EXISTS "catalogDisputed" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Stock" ADD COLUMN IF NOT EXISTS "catalogNote" TEXT;

CREATE TABLE IF NOT EXISTS "ToolCatalogConsumableEvent" (
  "id" TEXT NOT NULL,
  "stockId" TEXT,
  "materialId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "section" "ObjectSection" NOT NULL,
  "condition" "StockCondition" NOT NULL,
  "action" TEXT NOT NULL,
  "comment" TEXT,
  "actorId" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ToolCatalogConsumableEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ToolCatalogConsumableEvent_materialId_warehouseId_createdAt_idx"
  ON "ToolCatalogConsumableEvent"("materialId", "warehouseId", "createdAt");

ALTER TABLE "ToolCatalogConsumableEvent"
  ADD CONSTRAINT "ToolCatalogConsumableEvent_materialId_fkey"
  FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

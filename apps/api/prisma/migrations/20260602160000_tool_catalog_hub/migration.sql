-- Tool catalog hub: categories tree, receipt categories, stock condition, consumable issues

CREATE TYPE "ToolCatalogSection" AS ENUM (
  'TOOL_MANUAL',
  'TOOL_ELECTRIC_CORDLESS',
  'TOOL_ELECTRIC_CORDED',
  'PPE',
  'TOOL_CONSUMABLE',
  'KIP',
  'OTHER'
);

CREATE TYPE "StockCondition" AS ENUM ('NEW', 'USED');

ALTER TYPE "ReceiptItemCategory" ADD VALUE IF NOT EXISTS 'TOOL_MANUAL';
ALTER TYPE "ReceiptItemCategory" ADD VALUE IF NOT EXISTS 'TOOL_ELECTRIC_CORDLESS';
ALTER TYPE "ReceiptItemCategory" ADD VALUE IF NOT EXISTS 'TOOL_ELECTRIC_CORDED';
ALTER TYPE "ReceiptItemCategory" ADD VALUE IF NOT EXISTS 'PPE';
ALTER TYPE "ReceiptItemCategory" ADD VALUE IF NOT EXISTS 'TOOL_CONSUMABLE';
ALTER TYPE "ReceiptItemCategory" ADD VALUE IF NOT EXISTS 'KIP';
ALTER TYPE "ReceiptItemCategory" ADD VALUE IF NOT EXISTS 'OTHER';

ALTER TABLE "ToolCategory" ADD COLUMN IF NOT EXISTS "slug" TEXT;
ALTER TABLE "ToolCategory" ADD COLUMN IF NOT EXISTS "parentId" TEXT;

CREATE UNIQUE INDEX IF NOT EXISTS "ToolCategory_slug_key" ON "ToolCategory"("slug");
CREATE INDEX IF NOT EXISTS "ToolCategory_parentId_idx" ON "ToolCategory"("parentId");

DO $$ BEGIN
  ALTER TABLE "ToolCategory" ADD CONSTRAINT "ToolCategory_parentId_fkey"
    FOREIGN KEY ("parentId") REFERENCES "ToolCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

ALTER TABLE "Material" ADD COLUMN IF NOT EXISTS "toolCatalogSection" "ToolCatalogSection";

ALTER TABLE "Stock" ADD COLUMN IF NOT EXISTS "condition" "StockCondition" NOT NULL DEFAULT 'NEW';

ALTER TABLE "Stock" DROP CONSTRAINT IF EXISTS "Stock_warehouseId_materialId_section_key";
CREATE UNIQUE INDEX IF NOT EXISTS "Stock_warehouseId_materialId_section_condition_key"
  ON "Stock"("warehouseId", "materialId", "section", "condition");

CREATE TABLE IF NOT EXISTS "ToolConsumableIssue" (
  "id" TEXT NOT NULL,
  "toolId" TEXT NOT NULL,
  "materialId" TEXT NOT NULL,
  "warehouseId" TEXT NOT NULL,
  "section" "ObjectSection" NOT NULL DEFAULT 'SS',
  "issueRequestId" TEXT,
  "qtyIssued" DECIMAL(14,3) NOT NULL,
  "qtyReturnedNew" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "qtyReturnedUsed" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "qtyWrittenOff" DECIMAL(14,3) NOT NULL DEFAULT 0,
  "holderName" TEXT,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "writeoffReason" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "ToolConsumableIssue_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ToolConsumableIssue_toolId_status_idx" ON "ToolConsumableIssue"("toolId", "status");
CREATE INDEX IF NOT EXISTS "ToolConsumableIssue_warehouseId_section_idx" ON "ToolConsumableIssue"("warehouseId", "section");

DO $$ BEGIN
  ALTER TABLE "ToolConsumableIssue" ADD CONSTRAINT "ToolConsumableIssue_toolId_fkey"
    FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ToolConsumableIssue" ADD CONSTRAINT "ToolConsumableIssue_materialId_fkey"
    FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ToolConsumableIssue" ADD CONSTRAINT "ToolConsumableIssue_warehouseId_fkey"
    FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

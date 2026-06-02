-- AlterTable
ALTER TABLE "ReceiptRequest" ADD COLUMN "externalOrderNumber" TEXT;

-- AlterTable
ALTER TABLE "ReceiptRequestItem" ADD COLUMN "limitSectionPath" TEXT,
ADD COLUMN "namePartD" TEXT,
ADD COLUMN "namePartE" TEXT,
ADD COLUMN "limitCatalogNameN" TEXT,
ADD COLUMN "limitCatalogNameO" TEXT,
ADD COLUMN "externalComment" TEXT,
ADD COLUMN "limitNameRenamed" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "ObjectLimitNode" ADD COLUMN "nameAlertNote" TEXT;

-- CreateIndex
CREATE INDEX "ReceiptRequest_warehouseId_section_externalOrderNumber_idx" ON "ReceiptRequest"("warehouseId", "section", "externalOrderNumber");

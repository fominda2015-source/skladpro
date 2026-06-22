-- CreateTable
CREATE TABLE "StockMaterialLimitBinding" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "section" "ObjectSection" NOT NULL,
    "materialId" TEXT NOT NULL,
    "limitNodeId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL DEFAULT 1,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StockMaterialLimitBinding_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "StockMaterialLimitBinding_warehouseId_section_materialId_idx" ON "StockMaterialLimitBinding"("warehouseId", "section", "materialId");

-- CreateIndex
CREATE INDEX "StockMaterialLimitBinding_limitNodeId_idx" ON "StockMaterialLimitBinding"("limitNodeId");

-- CreateIndex
CREATE UNIQUE INDEX "StockMaterialLimitBinding_warehouseId_section_materialId_limitNodeId_key" ON "StockMaterialLimitBinding"("warehouseId", "section", "materialId", "limitNodeId");

-- AddForeignKey
ALTER TABLE "StockMaterialLimitBinding" ADD CONSTRAINT "StockMaterialLimitBinding_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMaterialLimitBinding" ADD CONSTRAINT "StockMaterialLimitBinding_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMaterialLimitBinding" ADD CONSTRAINT "StockMaterialLimitBinding_limitNodeId_fkey" FOREIGN KEY ("limitNodeId") REFERENCES "ObjectLimitNode"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StockMaterialLimitBinding" ADD CONSTRAINT "StockMaterialLimitBinding_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

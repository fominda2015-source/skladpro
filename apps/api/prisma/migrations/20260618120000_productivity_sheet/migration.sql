-- CreateTable
CREATE TABLE "ProductivitySheet" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "section" "ObjectSection" NOT NULL,
    "title" TEXT NOT NULL,
    "sourceFileName" TEXT NOT NULL,
    "storagePath" TEXT NOT NULL,
    "headerRow" INTEGER NOT NULL DEFAULT 1,
    "dataStartRow" INTEGER NOT NULL DEFAULT 5,
    "fixedColCount" INTEGER NOT NULL DEFAULT 7,
    "dateColumns" JSONB NOT NULL,
    "cellValues" JSONB NOT NULL DEFAULT '{}',
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ProductivitySheet_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "ProductivitySheet_warehouseId_section_key" ON "ProductivitySheet"("warehouseId", "section");

-- CreateIndex
CREATE INDEX "ProductivitySheet_warehouseId_section_updatedAt_idx" ON "ProductivitySheet"("warehouseId", "section", "updatedAt");

-- AddForeignKey
ALTER TABLE "ProductivitySheet" ADD CONSTRAINT "ProductivitySheet_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProductivitySheet" ADD CONSTRAINT "ProductivitySheet_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

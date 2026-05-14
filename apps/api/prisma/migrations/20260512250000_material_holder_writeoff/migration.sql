-- MaterialHolderWriteoff: списание с ответственного (материальный отчёт)

CREATE TABLE "MaterialHolderWriteoff" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "section" "ObjectSection" NOT NULL DEFAULT 'SS',
    "holderUserId" TEXT NOT NULL,
    "materialId" TEXT NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "actorUserId" TEXT NOT NULL,
    "comment" TEXT,
    "documentFileId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MaterialHolderWriteoff_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MaterialHolderWriteoff_warehouseId_section_holderUserId_idx" ON "MaterialHolderWriteoff"("warehouseId", "section", "holderUserId");

CREATE INDEX "MaterialHolderWriteoff_createdAt_idx" ON "MaterialHolderWriteoff"("createdAt");

ALTER TABLE "MaterialHolderWriteoff" ADD CONSTRAINT "MaterialHolderWriteoff_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaterialHolderWriteoff" ADD CONSTRAINT "MaterialHolderWriteoff_holderUserId_fkey" FOREIGN KEY ("holderUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaterialHolderWriteoff" ADD CONSTRAINT "MaterialHolderWriteoff_actorUserId_fkey" FOREIGN KEY ("actorUserId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "MaterialHolderWriteoff" ADD CONSTRAINT "MaterialHolderWriteoff_materialId_fkey" FOREIGN KEY ("materialId") REFERENCES "Material"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

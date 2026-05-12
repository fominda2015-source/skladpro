-- CreateEnum (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CampItemCategory') THEN
    CREATE TYPE "CampItemCategory" AS ENUM ('CONTAINER', 'EQUIPMENT', 'CABIN', 'TOOL', 'OTHER');
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'CampItemStatus') THEN
    CREATE TYPE "CampItemStatus" AS ENUM ('IN_USE', 'STORAGE', 'REPAIR', 'WRITTEN_OFF');
  END IF;
END $$;

-- CreateTable
CREATE TABLE IF NOT EXISTS "CampItem" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "CampItemCategory" NOT NULL DEFAULT 'OTHER',
    "inventoryNumber" TEXT,
    "serialNumber" TEXT,
    "manufacturer" TEXT,
    "location" TEXT,
    "description" TEXT,
    "warehouseId" TEXT,
    "section" "ObjectSection" NOT NULL DEFAULT 'SS',
    "status" "CampItemStatus" NOT NULL DEFAULT 'IN_USE',
    "acquiredAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CampItem_pkey" PRIMARY KEY ("id")
);

-- Foreign Keys (idempotent)
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CampItem_warehouseId_fkey'
  ) THEN
    ALTER TABLE "CampItem"
      ADD CONSTRAINT "CampItem_warehouseId_fkey"
      FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.table_constraints
    WHERE constraint_name = 'CampItem_createdById_fkey'
  ) THEN
    ALTER TABLE "CampItem"
      ADD CONSTRAINT "CampItem_createdById_fkey"
      FOREIGN KEY ("createdById") REFERENCES "User"("id")
      ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "CampItem_warehouseId_section_idx" ON "CampItem"("warehouseId", "section");
CREATE INDEX IF NOT EXISTS "CampItem_inventoryNumber_idx" ON "CampItem"("inventoryNumber");

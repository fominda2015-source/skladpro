-- CampItemCategory: новые категории городка
ALTER TYPE "CampItemCategory" RENAME TO "CampItemCategory_old";

CREATE TYPE "CampItemCategory" AS ENUM (
  'CONTAINER_CABIN',
  'FURNITURE',
  'OFFICE_EQUIPMENT',
  'APPLIANCES',
  'OTHER'
);

ALTER TABLE "CampItem" ALTER COLUMN "category" DROP DEFAULT;

ALTER TABLE "CampItem" ALTER COLUMN "category" TYPE "CampItemCategory" USING (
  CASE "category"::text
    WHEN 'CONTAINER' THEN 'CONTAINER_CABIN'
    WHEN 'CABIN' THEN 'CONTAINER_CABIN'
    WHEN 'EQUIPMENT' THEN 'OFFICE_EQUIPMENT'
    WHEN 'TOOL' THEN 'OTHER'
    WHEN 'OTHER' THEN 'OTHER'
    ELSE 'OTHER'
  END::"CampItemCategory"
);

ALTER TABLE "CampItem" ALTER COLUMN "category" SET DEFAULT 'OTHER';

DROP TYPE "CampItemCategory_old";

-- ReceiptItemCategory: категории приёмки для городка
ALTER TYPE "ReceiptItemCategory" ADD VALUE IF NOT EXISTS 'CAMP_CONTAINER_CABIN';
ALTER TYPE "ReceiptItemCategory" ADD VALUE IF NOT EXISTS 'CAMP_FURNITURE';
ALTER TYPE "ReceiptItemCategory" ADD VALUE IF NOT EXISTS 'CAMP_OFFICE_EQUIPMENT';
ALTER TYPE "ReceiptItemCategory" ADD VALUE IF NOT EXISTS 'CAMP_APPLIANCES';
ALTER TYPE "ReceiptItemCategory" ADD VALUE IF NOT EXISTS 'CAMP_OTHER';

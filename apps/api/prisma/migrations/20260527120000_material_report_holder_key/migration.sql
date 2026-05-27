-- Материальный отчёт: учёт по holderKey (кладовщик / ответственное лицо), не только по userId

ALTER TABLE "MaterialHolderWriteoff" ADD COLUMN "holderKey" TEXT;
ALTER TABLE "MaterialHolderWriteoff" ADD COLUMN "holderName" TEXT;

UPDATE "MaterialHolderWriteoff" AS w
SET
  "holderKey" = 'user:' || w."holderUserId",
  "holderName" = COALESCE(u."fullName", u."email", w."holderUserId")
FROM "User" AS u
WHERE u."id" = w."holderUserId";

ALTER TABLE "MaterialHolderWriteoff" ALTER COLUMN "holderKey" SET NOT NULL;
ALTER TABLE "MaterialHolderWriteoff" ALTER COLUMN "holderName" SET NOT NULL;
ALTER TABLE "MaterialHolderWriteoff" ALTER COLUMN "holderUserId" DROP NOT NULL;

CREATE INDEX "MaterialHolderWriteoff_warehouseId_section_holderKey_idx"
  ON "MaterialHolderWriteoff"("warehouseId", "section", "holderKey");

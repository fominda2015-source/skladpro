-- CreateEnum
CREATE TYPE "ReceiptItemCategory" AS ENUM ('EQUIPMENT', 'CONSUMABLE', 'CABLE');

-- AlterTable
ALTER TABLE "ReceiptRequestItem" ADD COLUMN "category" "ReceiptItemCategory",
ADD COLUMN "unitPrice" DECIMAL(14,2),
ADD COLUMN "storagePlace" TEXT;

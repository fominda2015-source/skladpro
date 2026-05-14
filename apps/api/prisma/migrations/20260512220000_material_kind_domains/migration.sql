-- CreateEnum
CREATE TYPE "MaterialKind" AS ENUM ('MATERIAL', 'CONSUMABLE', 'WORKWEAR');

-- AlterTable
ALTER TABLE "Material" ADD COLUMN "kind" "MaterialKind" NOT NULL DEFAULT 'MATERIAL',
ADD COLUMN "unitPrice" DECIMAL(14,2);

-- AlterTable
ALTER TABLE "IssueRequest" ADD COLUMN "limitReleasePath" TEXT;

-- AlterEnum IssueRequestDomain: new values for consumables / workwear issues
ALTER TYPE "IssueRequestDomain" ADD VALUE 'CONSUMABLES';
ALTER TYPE "IssueRequestDomain" ADD VALUE 'WORKWEAR';

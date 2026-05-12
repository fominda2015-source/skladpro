-- CreateEnum
CREATE TYPE "IssueRequestDomain" AS ENUM ('MATERIALS', 'TOOLS');

-- AlterTable
ALTER TABLE "IssueRequest" ADD COLUMN "domain" "IssueRequestDomain" NOT NULL DEFAULT 'MATERIALS';

-- CreateTable
CREATE TABLE "IssueRequestToolItem" (
    "id" TEXT NOT NULL,
    "issueRequestId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,

    CONSTRAINT "IssueRequestToolItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "IssueRequestToolItem_issueRequestId_idx" ON "IssueRequestToolItem"("issueRequestId");

-- CreateIndex
CREATE INDEX "IssueRequestToolItem_toolId_idx" ON "IssueRequestToolItem"("toolId");

-- AddForeignKey
ALTER TABLE "IssueRequestToolItem" ADD CONSTRAINT "IssueRequestToolItem_issueRequestId_fkey" FOREIGN KEY ("issueRequestId") REFERENCES "IssueRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "IssueRequestToolItem" ADD CONSTRAINT "IssueRequestToolItem_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

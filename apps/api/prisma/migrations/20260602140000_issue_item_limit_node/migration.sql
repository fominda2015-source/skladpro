-- Выдача: учёт по подразделу лимита (узел дерева), приход остаётся на своём limitNodeId в заявке на приёмку
ALTER TABLE "IssueRequestItem" ADD COLUMN "limitNodeId" TEXT;

CREATE INDEX "IssueRequestItem_limitNodeId_idx" ON "IssueRequestItem"("limitNodeId");

ALTER TABLE "IssueRequestItem" ADD CONSTRAINT "IssueRequestItem_limitNodeId_fkey"
  FOREIGN KEY ("limitNodeId") REFERENCES "ObjectLimitNode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

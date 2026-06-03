-- CreateIndex
CREATE INDEX "IssueRequest_createdAt_idx" ON "IssueRequest"("createdAt");

-- CreateIndex
CREATE INDEX "IssueRequest_warehouseId_section_createdAt_idx" ON "IssueRequest"("warehouseId", "section", "createdAt");

-- CreateIndex
CREATE INDEX "IssueRequestItem_issueRequestId_idx" ON "IssueRequestItem"("issueRequestId");

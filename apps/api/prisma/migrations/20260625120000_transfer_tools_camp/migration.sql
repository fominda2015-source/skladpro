CREATE TABLE "TransferRequestToolLine" (
    "id" TEXT NOT NULL,
    "transferRequestId" TEXT NOT NULL,
    "toolId" TEXT NOT NULL,

    CONSTRAINT "TransferRequestToolLine_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "TransferRequestCampLine" (
    "id" TEXT NOT NULL,
    "transferRequestId" TEXT NOT NULL,
    "campItemId" TEXT NOT NULL,

    CONSTRAINT "TransferRequestCampLine_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "TransferRequestToolLine_transferRequestId_toolId_key" ON "TransferRequestToolLine"("transferRequestId", "toolId");
CREATE INDEX "TransferRequestToolLine_transferRequestId_idx" ON "TransferRequestToolLine"("transferRequestId");

CREATE UNIQUE INDEX "TransferRequestCampLine_transferRequestId_campItemId_key" ON "TransferRequestCampLine"("transferRequestId", "campItemId");
CREATE INDEX "TransferRequestCampLine_transferRequestId_idx" ON "TransferRequestCampLine"("transferRequestId");

ALTER TABLE "TransferRequestToolLine" ADD CONSTRAINT "TransferRequestToolLine_transferRequestId_fkey" FOREIGN KEY ("transferRequestId") REFERENCES "TransferRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransferRequestToolLine" ADD CONSTRAINT "TransferRequestToolLine_toolId_fkey" FOREIGN KEY ("toolId") REFERENCES "Tool"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "TransferRequestCampLine" ADD CONSTRAINT "TransferRequestCampLine_transferRequestId_fkey" FOREIGN KEY ("transferRequestId") REFERENCES "TransferRequest"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "TransferRequestCampLine" ADD CONSTRAINT "TransferRequestCampLine_campItemId_fkey" FOREIGN KEY ("campItemId") REFERENCES "CampItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

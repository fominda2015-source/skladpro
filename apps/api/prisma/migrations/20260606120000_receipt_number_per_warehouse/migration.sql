-- Номер заявки уникален в рамках объекта (склада), не глобально.
DROP INDEX IF EXISTS "ReceiptRequest_number_key";

CREATE UNIQUE INDEX "ReceiptRequest_warehouseId_number_key" ON "ReceiptRequest"("warehouseId", "number");

CREATE INDEX "ReceiptRequest_warehouseId_sourceFileName_idx" ON "ReceiptRequest"("warehouseId", "sourceFileName");

-- Фактическое название по УПД на позиции приходной заявки (отдельно от sourceName / лимита).
ALTER TABLE "ReceiptRequestItem" ADD COLUMN "factLabel" TEXT;
ALTER TABLE "ReceiptRequestItem" ADD COLUMN "factUnit" TEXT;

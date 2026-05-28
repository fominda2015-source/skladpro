-- Срок следующей поверки инструмента (по ТЗ вкладка «Поверки»)
ALTER TABLE "Tool" ADD COLUMN "calibrationDueAt" TIMESTAMP(3);

CREATE INDEX "Tool_calibrationDueAt_idx" ON "Tool"("calibrationDueAt");

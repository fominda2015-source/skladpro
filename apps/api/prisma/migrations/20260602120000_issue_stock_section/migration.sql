-- Выдача: учёт по section, списание остатка по stockSection (кросс-корпус СС/ЭОМ)
ALTER TABLE "IssueRequest" ADD COLUMN "stockSection" "ObjectSection";

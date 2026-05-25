-- Tool categories: manual catalog + categoryId on Tool.
CREATE TABLE IF NOT EXISTS "ToolCategory" (
  "id"        TEXT PRIMARY KEY,
  "name"      TEXT NOT NULL UNIQUE,
  "icon"      TEXT,
  "order"     INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

ALTER TABLE "Tool"
  ADD COLUMN IF NOT EXISTS "categoryId" TEXT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'Tool_categoryId_fkey'
  ) THEN
    ALTER TABLE "Tool"
      ADD CONSTRAINT "Tool_categoryId_fkey"
      FOREIGN KEY ("categoryId") REFERENCES "ToolCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Tool_categoryId_idx" ON "Tool"("categoryId");
CREATE INDEX IF NOT EXISTS "Tool_name_idx"       ON "Tool"("name");

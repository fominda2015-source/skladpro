-- Add eventCode to Notification, plus NotificationRule and AppSetting tables.
ALTER TABLE "Notification"
  ADD COLUMN IF NOT EXISTS "eventCode" TEXT;
CREATE INDEX IF NOT EXISTS "Notification_eventCode_idx" ON "Notification"("eventCode");

CREATE TABLE IF NOT EXISTS "NotificationRule" (
  "id"        TEXT PRIMARY KEY,
  "userId"    TEXT NOT NULL,
  "eventCode" TEXT NOT NULL,
  "enabled"   BOOLEAN NOT NULL DEFAULT TRUE,
  "level"     "NotificationLevel",
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "NotificationRule_userId_eventCode_key"
  ON "NotificationRule"("userId", "eventCode");
CREATE INDEX IF NOT EXISTS "NotificationRule_eventCode_enabled_idx"
  ON "NotificationRule"("eventCode", "enabled");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'NotificationRule_userId_fkey') THEN
    ALTER TABLE "NotificationRule"
      ADD CONSTRAINT "NotificationRule_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "AppSetting" (
  "key"       TEXT PRIMARY KEY,
  "value"     TEXT NOT NULL,
  "updatedAt" TIMESTAMP(3) NOT NULL
);

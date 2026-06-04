-- Индивидуальные права отключены: доступ только по роли.
UPDATE "User" SET "customPermissions" = '[]'::jsonb WHERE "customPermissions" IS NOT NULL;

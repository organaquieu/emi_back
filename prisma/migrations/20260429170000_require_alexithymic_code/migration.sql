-- Ensure every alexithymic user has a profile and generated code.
INSERT INTO "AlexithymicProfile" ("userId", "code")
SELECT
  u."id",
  'C-' || UPPER(REPLACE(u."id", '-', ''))
FROM "User" u
LEFT JOIN "AlexithymicProfile" ap ON ap."userId" = u."id"
WHERE u."role" = 'ALEXITHYMIC'
  AND ap."userId" IS NULL;

UPDATE "AlexithymicProfile"
SET "code" = 'C-' || UPPER(REPLACE("userId", '-', ''))
WHERE "code" IS NULL OR BTRIM("code") = '';

ALTER TABLE "AlexithymicProfile"
ALTER COLUMN "code" SET NOT NULL;

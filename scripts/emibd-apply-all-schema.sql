-- Run on emibd (Yandex) connected as owner (e.g. emiuser1). Idempotent where possible.
-- Fixes missing: DiaryEntry.behavior/behaviorAlt (+ other DiaryEntry cols from migrations),
-- Reflection + ReflectionStateChange, TasAttempt + TasCategory, User.phone + email nullable.
-- After success, mark Prisma migrations as applied (see bottom) or `prisma migrate deploy` may error on duplicate TYPE.

BEGIN;

-- DiaryEntry (from 20260411123000 + behaviorAlt)
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'DiaryEntry' AND column_name = 'rawText'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'DiaryEntry' AND column_name = 'situation'
  ) THEN
    ALTER TABLE "DiaryEntry" RENAME COLUMN "rawText" TO "situation";
  END IF;
END $$;

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'DiaryEntry' AND column_name = 'tag'
  ) AND NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'DiaryEntry' AND column_name = 'tags'
  ) THEN
    ALTER TABLE "DiaryEntry" RENAME COLUMN "tag" TO "tags";
  END IF;
END $$;

ALTER TABLE "DiaryEntry" ADD COLUMN IF NOT EXISTS "situation" TEXT;
ALTER TABLE "DiaryEntry" ADD COLUMN IF NOT EXISTS "thought" TEXT;
ALTER TABLE "DiaryEntry" ADD COLUMN IF NOT EXISTS "reaction" TEXT;
ALTER TABLE "DiaryEntry" ADD COLUMN IF NOT EXISTS "emotion" TEXT;
ALTER TABLE "DiaryEntry" ADD COLUMN IF NOT EXISTS "behavior" TEXT;
ALTER TABLE "DiaryEntry" ADD COLUMN IF NOT EXISTS "tags" TEXT;
ALTER TABLE "DiaryEntry" ADD COLUMN IF NOT EXISTS "behaviorAlt" TEXT;

-- User (20260418100000)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT;
ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "User_phone_key" ON "User" ("phone");

-- Enums
DO $$
BEGIN
  CREATE TYPE "ReflectionStateChange" AS ENUM ('BETTER', 'SLIGHTLY_BETTER', 'NO_CHANGE', 'WORSE');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

DO $$
BEGIN
  CREATE TYPE "TasCategory" AS ENUM ('NONE', 'POSSIBLE', 'ALEXITHYMIA');
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- Reflection
CREATE TABLE IF NOT EXISTS "Reflection" (
    "id" TEXT NOT NULL,
    "diaryEntryId" TEXT NOT NULL,
    "emotions" JSONB NOT NULL,
    "stateChange" "ReflectionStateChange" NOT NULL,
    "plans" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "Reflection_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Reflection_diaryEntryId_key" ON "Reflection"("diaryEntryId");

DO $$
BEGIN
  ALTER TABLE "Reflection"
    ADD CONSTRAINT "Reflection_diaryEntryId_fkey"
    FOREIGN KEY ("diaryEntryId") REFERENCES "DiaryEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

-- TasAttempt
CREATE TABLE IF NOT EXISTS "TasAttempt" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "totalScore" INTEGER NOT NULL,
    "difScore" INTEGER NOT NULL,
    "ddfScore" INTEGER NOT NULL,
    "eotScore" INTEGER NOT NULL,
    "category" "TasCategory" NOT NULL,
    CONSTRAINT "TasAttempt_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "TasAttempt_userId_completedAt_idx" ON "TasAttempt"("userId", "completedAt");

DO $$
BEGIN
  ALTER TABLE "TasAttempt"
    ADD CONSTRAINT "TasAttempt_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

COMMIT;

-- Next: tell Prisma these migrations are on the DB (otherwise `migrate deploy` will try CREATE TYPE again and fail).
-- From project root, with DATABASE_URL=emibd:
--
-- npx prisma migrate resolve --applied "20260411123000_diary_entry_situation_tags"
-- npx prisma migrate resolve --applied "20260413133000_remove_notifications"
-- npx prisma migrate resolve --applied "20260414110000_add_behavior_alt_to_diary_entry"
-- npx prisma migrate resolve --applied "20260416120000_add_reflection"
-- npx prisma migrate resolve --applied "20260416130000_add_tas_attempt"
-- npx prisma migrate resolve --applied "20260418100000_user_phone_nullable_email"
--
-- Then: npx prisma migrate deploy   (should report "already applied" / no pending)

-- Привести DiaryEntry к актуальной схеме Prisma (сохранить данные из старых колонок).

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

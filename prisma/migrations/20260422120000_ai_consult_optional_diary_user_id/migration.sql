-- AI consult: optional diary link; store userId for rate limiting and standalone consults.
ALTER TABLE "AIConsultation" ADD COLUMN IF NOT EXISTS "userId" TEXT;

UPDATE "AIConsultation" a
SET "userId" = d."alexithymicId"
FROM "DiaryEntry" d
WHERE a."diaryEntryId" = d."id" AND a."userId" IS NULL;

ALTER TABLE "AIConsultation" ALTER COLUMN "diaryEntryId" DROP NOT NULL;

DO $$
BEGIN
  ALTER TABLE "AIConsultation"
    ADD CONSTRAINT "AIConsultation_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION
  WHEN duplicate_object THEN NULL;
END $$;

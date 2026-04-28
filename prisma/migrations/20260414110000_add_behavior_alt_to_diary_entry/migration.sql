-- Добавить альтернативное поведение в запись дневника.
ALTER TABLE "DiaryEntry" ADD COLUMN IF NOT EXISTS "behaviorAlt" TEXT;

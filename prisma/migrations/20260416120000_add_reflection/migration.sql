-- CreateEnum
CREATE TYPE "ReflectionStateChange" AS ENUM ('BETTER', 'SLIGHTLY_BETTER', 'NO_CHANGE', 'WORSE');

-- CreateTable
CREATE TABLE "Reflection" (
    "id" TEXT NOT NULL,
    "diaryEntryId" TEXT NOT NULL,
    "emotions" JSONB NOT NULL,
    "stateChange" "ReflectionStateChange" NOT NULL,
    "plans" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Reflection_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Reflection_diaryEntryId_key" ON "Reflection"("diaryEntryId");

-- AddForeignKey
ALTER TABLE "Reflection" ADD CONSTRAINT "Reflection_diaryEntryId_fkey" FOREIGN KEY ("diaryEntryId") REFERENCES "DiaryEntry"("id") ON DELETE CASCADE ON UPDATE CASCADE;

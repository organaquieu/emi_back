-- CreateEnum
CREATE TYPE "TasCategory" AS ENUM ('NONE', 'POSSIBLE', 'ALEXITHYMIA');

-- CreateTable
CREATE TABLE "TasAttempt" (
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

-- CreateIndex
CREATE INDEX "TasAttempt_userId_completedAt_idx" ON "TasAttempt"("userId", "completedAt");

-- AddForeignKey
ALTER TABLE "TasAttempt" ADD CONSTRAINT "TasAttempt_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

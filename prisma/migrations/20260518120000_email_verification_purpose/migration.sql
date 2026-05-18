-- CreateEnum
CREATE TYPE "EmailVerificationPurpose" AS ENUM ('REGISTRATION', 'PASSWORD_RESET');

-- AlterTable
ALTER TABLE "EmailVerificationCode" ADD COLUMN "purpose" "EmailVerificationPurpose" NOT NULL DEFAULT 'REGISTRATION';

-- DropIndex
DROP INDEX IF EXISTS "EmailVerificationCode_email_expiresAt_idx";

-- CreateIndex
CREATE INDEX "EmailVerificationCode_email_purpose_expiresAt_idx" ON "EmailVerificationCode"("email", "purpose", "expiresAt");

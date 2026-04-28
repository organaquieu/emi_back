-- Align "User" with schema.prisma (was missing from earlier migration history).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "phone" TEXT;

ALTER TABLE "User" ALTER COLUMN "email" DROP NOT NULL;

CREATE UNIQUE INDEX IF NOT EXISTS "User_phone_key" ON "User" ("phone");

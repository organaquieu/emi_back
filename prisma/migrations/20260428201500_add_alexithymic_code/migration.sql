-- Add optional unique client code for alexithymic profile
ALTER TABLE "AlexithymicProfile"
ADD COLUMN "code" TEXT;

CREATE UNIQUE INDEX "AlexithymicProfile_code_key"
ON "AlexithymicProfile"("code");

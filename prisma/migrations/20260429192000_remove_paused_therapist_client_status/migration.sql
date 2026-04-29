-- Convert old PAUSED links to FINISHED before enum change.
UPDATE "TherapistClient"
SET "status" = 'FINISHED'
WHERE "status" = 'PAUSED';

-- Recreate enum without PAUSED value.
ALTER TYPE "TherapistClientStatus" RENAME TO "TherapistClientStatus_old";

CREATE TYPE "TherapistClientStatus" AS ENUM ('ACTIVE', 'FINISHED');

ALTER TABLE "TherapistClient"
ALTER COLUMN "status" DROP DEFAULT,
ALTER COLUMN "status" TYPE "TherapistClientStatus"
USING ("status"::text::"TherapistClientStatus"),
ALTER COLUMN "status" SET DEFAULT 'ACTIVE';

DROP TYPE "TherapistClientStatus_old";

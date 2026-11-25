ALTER TABLE "customers" ADD COLUMN IF NOT EXISTS "assignedCollectorId" TEXT;

CREATE INDEX IF NOT EXISTS "customers_assignedCollectorId_idx"
ON "customers"("assignedCollectorId");

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'customers_assignedCollectorId_fkey') THEN
    ALTER TABLE "customers"
    ADD CONSTRAINT "customers_assignedCollectorId_fkey"
    FOREIGN KEY ("assignedCollectorId") REFERENCES "users"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

UPDATE "users" SET "name" = 'Admin' WHERE "email" = 'admin@tridin.com';

WITH single_active_collector AS (
  SELECT MIN("id") AS "id"
  FROM "users"
  WHERE "role" = 'COLLECTION_STAFF' AND "active" = TRUE
  HAVING COUNT(*) = 1
)
UPDATE "customers"
SET "assignedCollectorId" = (SELECT "id" FROM single_active_collector)
WHERE "assignedCollectorId" IS NULL
  AND EXISTS (SELECT 1 FROM single_active_collector);

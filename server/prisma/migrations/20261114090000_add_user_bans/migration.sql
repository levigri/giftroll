ALTER TABLE "users"
ADD COLUMN "isBanned" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "banReason" TEXT;

UPDATE "users"
SET "isBanned" = true,
    "banReason" = 'Мультиаккаунты'
WHERE "id" IN (8822016701, 8912297149, 8787609548, 8908394382, 8656486687, 8721926324);

UPDATE "users"
SET "balance" = 0
WHERE "id" = 8822016701;

UPDATE "inventory_items"
SET "status" = 'CLAIMED'
WHERE "userId" = 8822016701
  AND "status" IN ('PENDING', 'WITHDRAWAL_REQUESTED');

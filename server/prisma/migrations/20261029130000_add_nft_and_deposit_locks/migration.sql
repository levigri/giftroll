ALTER TABLE "inventory_items"
ADD COLUMN "isExternal" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "lockUntil" TIMESTAMP(3);

ALTER TABLE "deposits"
ADD COLUMN "lockUntil" TIMESTAMP(3);

-- Backfill active deposit locks using the original completion time where available.
UPDATE "deposits"
SET "lockUntil" = COALESCE("completedAt", "createdAt") + INTERVAL '21 days'
WHERE "status" = 'completed';

-- Gifts created by the previous Userbot implementation are recognizable by prizeId.
UPDATE "inventory_items"
SET "isExternal" = true,
    "lockUntil" = "createdAt" + INTERVAL '21 days'
WHERE "prizeId" LIKE 'telegram-gift:%';
-- Legacy prototype Userbot entries used the shorter gift-<timestamp> prefix.
UPDATE "inventory_items"
SET "isExternal" = true,
    "lockUntil" = "createdAt" + INTERVAL '21 days'
WHERE "prizeId" LIKE 'gift-%' AND "isExternal" = false;

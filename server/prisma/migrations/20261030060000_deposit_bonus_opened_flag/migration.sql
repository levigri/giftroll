ALTER TABLE "users"
ADD COLUMN "depositBonusOpened" BOOLEAN NOT NULL DEFAULT FALSE;

-- Backfill users who had already consumed the old one-time ticket.
UPDATE "users"
SET "depositBonusOpened" = TRUE
WHERE "depositBonusGranted" = TRUE
  AND "freeCases" = 0
  AND "hasClaimedDepositBonus" = TRUE;

ALTER TABLE "users"
ADD COLUMN "gramBalance" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN "cryptoBalance" DOUBLE PRECISION NOT NULL DEFAULT 0;

ALTER TABLE "deposits"
ADD COLUMN "cryptoAmount" DOUBLE PRECISION,
ADD COLUMN "bonusPercent" INTEGER NOT NULL DEFAULT 0;

UPDATE "deposits"
SET "bonusPercent" = CASE
  WHEN "currency" = 'STARS' AND "createdAt" < TIMESTAMP '2026-11-15 16:39:34' THEN 10
  WHEN "currency" = 'GRAMS' AND "createdAt" < TIMESTAMP '2026-11-15 16:39:34' THEN 15
  WHEN "currency" = 'GRAMS' THEN 5
  ELSE 0
END;

ALTER TABLE "pvp_rounds"
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'STARS',
ALTER COLUMN "totalStars" TYPE DOUBLE PRECISION USING "totalStars"::DOUBLE PRECISION,
ALTER COLUMN "rakeStars" TYPE DOUBLE PRECISION USING "rakeStars"::DOUBLE PRECISION;

ALTER TABLE "pvp_participants"
ALTER COLUMN "stars" TYPE DOUBLE PRECISION USING "stars"::DOUBLE PRECISION;

ALTER TABLE "upgrader_attempts"
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'STARS',
ALTER COLUMN "betAmount" TYPE DOUBLE PRECISION USING "betAmount"::DOUBLE PRECISION,
ALTER COLUMN "winAmount" TYPE DOUBLE PRECISION USING "winAmount"::DOUBLE PRECISION,
ALTER COLUMN "targetNftPrice" TYPE DOUBLE PRECISION USING "targetNftPrice"::DOUBLE PRECISION;

ALTER TABLE "case_opens"
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'STARS',
ADD COLUMN "casePrice" DOUBLE PRECISION,
ALTER COLUMN "prizePrice" TYPE DOUBLE PRECISION USING "prizePrice"::DOUBLE PRECISION;

ALTER TABLE "transactions"
ADD COLUMN "currency" TEXT NOT NULL DEFAULT 'STARS';

-- Keep the existing 21-day hold only when a completed Stars deposit was active
-- when the NFT entered inventory. GRAM/Crypto deposits never hold NFT prizes.
UPDATE "inventory_items" AS item
SET "lockUntil" = (
  SELECT COALESCE(
    deposit."lockUntil",
    COALESCE(deposit."completedAt", deposit."createdAt") + INTERVAL '21 days'
  )
  FROM "deposits" AS deposit
  WHERE deposit."userId" = item."userId"
    AND deposit."status" = 'completed'
    AND deposit."currency" = 'STARS'
    AND COALESCE(deposit."completedAt", deposit."createdAt") <= item."createdAt"
    AND COALESCE(
      deposit."lockUntil",
      COALESCE(deposit."completedAt", deposit."createdAt") + INTERVAL '21 days'
    ) > item."createdAt"
  ORDER BY COALESCE(deposit."completedAt", deposit."createdAt") DESC
  LIMIT 1
)
WHERE item."isExternal" = false;

UPDATE "inventory_items"
SET "lockUntil" = NULL
WHERE "isExternal" = true;

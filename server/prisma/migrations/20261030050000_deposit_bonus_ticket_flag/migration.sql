ALTER TABLE "users"
ALTER COLUMN "hasClaimedDepositBonus" SET DEFAULT TRUE;

-- Keep tickets already issued by the old flow; close false defaults for users
-- who never completed a qualifying deposit.
UPDATE "users" AS u
SET "hasClaimedDepositBonus" = TRUE
WHERE u."hasClaimedDepositBonus" = FALSE
  AND NOT EXISTS (
    SELECT 1
    FROM "deposits" AS d
    WHERE d."userId" = u.id
      AND d.status = 'completed'
      AND d.amount >= 200
  );

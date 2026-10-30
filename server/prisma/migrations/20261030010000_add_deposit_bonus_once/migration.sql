-- Бонусный кейс за депозит от 200 ⭐ выдаётся один раз за всю историю аккаунта.
ALTER TABLE "users" ADD COLUMN "depositBonusGranted" BOOLEAN NOT NULL DEFAULT false;

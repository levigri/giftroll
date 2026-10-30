-- После открытия бонусного кейса за депозит карточка больше не показывается.
ALTER TABLE "users" ADD COLUMN "hasClaimedDepositBonus" BOOLEAN NOT NULL DEFAULT false;

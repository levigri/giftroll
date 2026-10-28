-- AlterTable
ALTER TABLE "users" ADD COLUMN     "depositUnspent" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "refEarnings" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "referredBy" BIGINT;

-- CreateTable
CREATE TABLE "deposits" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "amount" INTEGER NOT NULL,
    "status" TEXT NOT NULL,
    "telegramChargeId" TEXT,
    "payload" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3),

    CONSTRAINT "deposits_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_earnings" (
    "id" TEXT NOT NULL,
    "referrerId" BIGINT NOT NULL,
    "referredId" BIGINT NOT NULL,
    "amount" INTEGER NOT NULL,
    "sourceType" TEXT NOT NULL,
    "sourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_earnings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_attempts" (
    "id" TEXT NOT NULL,
    "referrerId" BIGINT NOT NULL,
    "referredId" BIGINT NOT NULL,
    "status" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "referral_attempts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "deposits_telegramChargeId_key" ON "deposits"("telegramChargeId");

-- CreateIndex
CREATE UNIQUE INDEX "deposits_payload_key" ON "deposits"("payload");

-- CreateIndex
CREATE INDEX "deposits_userId_idx" ON "deposits"("userId");

-- CreateIndex
CREATE INDEX "deposits_status_idx" ON "deposits"("status");

-- CreateIndex
CREATE INDEX "referral_earnings_referrerId_idx" ON "referral_earnings"("referrerId");

-- CreateIndex
CREATE INDEX "referral_earnings_createdAt_idx" ON "referral_earnings"("createdAt");

-- CreateIndex
CREATE INDEX "referral_attempts_referrerId_createdAt_idx" ON "referral_attempts"("referrerId", "createdAt");

-- CreateIndex
CREATE INDEX "referral_attempts_referredId_idx" ON "referral_attempts"("referredId");

-- CreateIndex
CREATE INDEX "users_referredBy_idx" ON "users"("referredBy");

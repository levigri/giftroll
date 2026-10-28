-- CreateEnum
CREATE TYPE "PrizeType" AS ENUM ('BALANCE', 'NFT');

-- CreateEnum
CREATE TYPE "InventoryStatus" AS ENUM ('PENDING', 'SENT', 'CLAIMED');

-- CreateTable
CREATE TABLE "users" (
    "id" BIGINT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT,
    "username" TEXT,
    "photoUrl" TEXT,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "users_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "case_opens" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "caseId" TEXT NOT NULL,
    "prizeId" TEXT NOT NULL,
    "prizeType" "PrizeType" NOT NULL,
    "prizePrice" INTEGER NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "case_opens_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "inventory_items" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "prizeId" TEXT NOT NULL,
    "prizeName" TEXT NOT NULL,
    "prizeEmoji" TEXT NOT NULL,
    "prizePrice" INTEGER NOT NULL,
    "giftId" TEXT,
    "status" "InventoryStatus" NOT NULL DEFAULT 'PENDING',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "inventory_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "daily_bonuses" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "lastClaimedAt" TIMESTAMP(3) NOT NULL,
    "streak" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "daily_bonuses_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "case_opens_userId_idx" ON "case_opens"("userId");

-- CreateIndex
CREATE INDEX "inventory_items_userId_idx" ON "inventory_items"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "daily_bonuses_userId_key" ON "daily_bonuses"("userId");

-- AddForeignKey
ALTER TABLE "case_opens" ADD CONSTRAINT "case_opens_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "inventory_items" ADD CONSTRAINT "inventory_items_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "daily_bonuses" ADD CONSTRAINT "daily_bonuses_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

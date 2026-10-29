-- CreateTable
CREATE TABLE "telegram_gift_receipts" (
    "id" TEXT NOT NULL,
    "peerId" TEXT NOT NULL,
    "messageId" INTEGER NOT NULL,
    "senderUserId" BIGINT NOT NULL,
    "inventoryItemId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "telegram_gift_receipts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "telegram_gift_receipts_peerId_messageId_key" ON "telegram_gift_receipts"("peerId", "messageId");

-- CreateIndex
CREATE INDEX "telegram_gift_receipts_senderUserId_createdAt_idx" ON "telegram_gift_receipts"("senderUserId", "createdAt");

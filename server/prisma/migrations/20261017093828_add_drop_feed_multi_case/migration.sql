-- CreateTable
CREATE TABLE "drop_events" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "username" TEXT,
    "eventType" TEXT NOT NULL,
    "itemName" TEXT NOT NULL,
    "itemEmoji" TEXT,
    "itemPrice" INTEGER NOT NULL,
    "sourceName" TEXT,
    "sourceEmoji" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "drop_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "drop_events_createdAt_idx" ON "drop_events"("createdAt");

-- CreateIndex
CREATE INDEX "drop_events_itemPrice_idx" ON "drop_events"("itemPrice");

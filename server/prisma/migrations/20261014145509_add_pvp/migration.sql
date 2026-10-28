-- CreateTable
CREATE TABLE "pvp_rooms" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "player1Id" BIGINT NOT NULL,
    "player1Stars" INTEGER NOT NULL,
    "player1NftIds" JSONB NOT NULL DEFAULT '[]',
    "player2Id" BIGINT,
    "player2Stars" INTEGER,
    "player2NftIds" JSONB,
    "winnerId" BIGINT,
    "rakeStars" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "pvp_rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pvp_queue_entries" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "stars" INTEGER NOT NULL,
    "nftIds" JSONB NOT NULL DEFAULT '[]',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pvp_queue_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pvp_rooms_player1Id_idx" ON "pvp_rooms"("player1Id");

-- CreateIndex
CREATE INDEX "pvp_rooms_player2Id_idx" ON "pvp_rooms"("player2Id");

-- CreateIndex
CREATE INDEX "pvp_rooms_status_idx" ON "pvp_rooms"("status");

-- CreateIndex
CREATE UNIQUE INDEX "pvp_queue_entries_userId_key" ON "pvp_queue_entries"("userId");

/*
  Warnings:

  - You are about to drop the `pvp_queue_entries` table. If the table is not empty, all the data it contains will be lost.
  - You are about to drop the `pvp_rooms` table. If the table is not empty, all the data it contains will be lost.

*/
-- DropTable
DROP TABLE "pvp_queue_entries";

-- DropTable
DROP TABLE "pvp_rooms";

-- CreateTable
CREATE TABLE "pvp_rounds" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "totalStars" INTEGER NOT NULL DEFAULT 0,
    "winnerId" BIGINT,
    "rakeStars" INTEGER NOT NULL DEFAULT 0,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pvp_rounds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "pvp_participants" (
    "id" TEXT NOT NULL,
    "roundId" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "username" TEXT,
    "stars" INTEGER NOT NULL,
    "isBot" BOOLEAN NOT NULL DEFAULT false,
    "joinedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "pvp_participants_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "pvp_rounds_status_idx" ON "pvp_rounds"("status");

-- CreateIndex
CREATE INDEX "pvp_participants_userId_idx" ON "pvp_participants"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "pvp_participants_roundId_userId_key" ON "pvp_participants"("roundId", "userId");

-- AddForeignKey
ALTER TABLE "pvp_participants" ADD CONSTRAINT "pvp_participants_roundId_fkey" FOREIGN KEY ("roundId") REFERENCES "pvp_rounds"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "upgrader_attempts" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "targetNftId" TEXT NOT NULL,
    "targetNftName" TEXT NOT NULL,
    "targetNftEmoji" TEXT NOT NULL,
    "targetNftPrice" INTEGER NOT NULL,
    "betAmount" INTEGER NOT NULL,
    "chance" DOUBLE PRECISION NOT NULL,
    "win" BOOLEAN NOT NULL,
    "winAmount" INTEGER NOT NULL,
    "isBetaMode" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "upgrader_attempts_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "upgrader_attempts_userId_createdAt_idx"
    ON "upgrader_attempts"("userId", "createdAt");

ALTER TABLE "upgrader_attempts"
    ADD CONSTRAINT "upgrader_attempts_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

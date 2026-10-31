ALTER TABLE "users"
ADD COLUMN "notifiedAt" TIMESTAMP(3);

CREATE TABLE "UserTask" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "taskId" TEXT NOT NULL,
    "claimedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserTask_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "UserTask_userId_taskId_key" ON "UserTask"("userId", "taskId");
CREATE INDEX "UserTask_userId_idx" ON "UserTask"("userId");

ALTER TABLE "UserTask"
ADD CONSTRAINT "UserTask_userId_fkey"
FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

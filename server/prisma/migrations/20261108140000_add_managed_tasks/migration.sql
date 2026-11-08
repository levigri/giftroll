CREATE TABLE "managed_tasks" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "reward" INTEGER NOT NULL,
    "emoji" TEXT NOT NULL DEFAULT '📢',
    "type" TEXT NOT NULL,
    "target" INTEGER,
    "channelUsername" TEXT,
    "maxCompletions" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "managed_tasks_pkey" PRIMARY KEY ("id")
);

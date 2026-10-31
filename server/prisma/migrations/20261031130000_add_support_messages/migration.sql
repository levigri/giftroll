CREATE TABLE "SupportMessage" (
    "id" TEXT NOT NULL,
    "userId" BIGINT NOT NULL,
    "direction" TEXT NOT NULL,
    "adminMessageId" INTEGER,
    "text" TEXT,
    "mediaType" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SupportMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupportMessage_adminMessageId_key" ON "SupportMessage"("adminMessageId");
CREATE INDEX "SupportMessage_userId_createdAt_idx" ON "SupportMessage"("userId", "createdAt");

-- AlterTable
ALTER TABLE "deposits" ADD COLUMN     "currency" TEXT NOT NULL DEFAULT 'STARS',
ADD COLUMN     "gramsAmount" DOUBLE PRECISION,
ADD COLUMN     "txHash" TEXT;

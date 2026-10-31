ALTER TABLE "inventory_items"
ADD COLUMN "withdrawalChargeId" TEXT;

CREATE UNIQUE INDEX "inventory_items_withdrawalChargeId_key"
ON "inventory_items"("withdrawalChargeId");

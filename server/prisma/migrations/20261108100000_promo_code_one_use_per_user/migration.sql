CREATE TABLE "promo_code_redemptions" (
    "id" TEXT NOT NULL,
    "promoCodeId" UUID NOT NULL,
    "userId" BIGINT NOT NULL,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "promo_code_redemptions_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "promo_code_redemptions_promoCodeId_userId_key"
    ON "promo_code_redemptions"("promoCodeId", "userId");

CREATE INDEX "promo_code_redemptions_userId_idx"
    ON "promo_code_redemptions"("userId");

ALTER TABLE "promo_code_redemptions"
    ADD CONSTRAINT "promo_code_redemptions_promoCodeId_fkey"
    FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "promo_code_redemptions"
    ADD CONSTRAINT "promo_code_redemptions_userId_fkey"
    FOREIGN KEY ("userId") REFERENCES "users"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;

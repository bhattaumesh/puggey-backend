CREATE TABLE "products" (
    "id" TEXT NOT NULL,
    "tenantId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "products_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "products_tenantId_name_key" ON "products"("tenantId", "name");
CREATE INDEX "products_tenantId_idx" ON "products"("tenantId");

ALTER TABLE "products" ADD CONSTRAINT "products_tenantId_fkey" FOREIGN KEY ("tenantId") REFERENCES "tenants"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "product_received_logs" ADD COLUMN "productId" TEXT;
CREATE INDEX "product_received_logs_productId_idx" ON "product_received_logs"("productId");
ALTER TABLE "product_received_logs" ADD CONSTRAINT "product_received_logs_productId_fkey" FOREIGN KEY ("productId") REFERENCES "products"("id") ON DELETE SET NULL ON UPDATE CASCADE;

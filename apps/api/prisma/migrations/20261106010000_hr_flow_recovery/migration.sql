ALTER TABLE "CompanyProfileDocument" ADD COLUMN "retiredAt" TIMESTAMP(3);
ALTER TABLE "JobPurchaseOrder" ADD COLUMN "nextReconcileAt" TIMESTAMP(3);
CREATE INDEX "JobPurchaseOrder_status_nextReconcileAt_idx" ON "JobPurchaseOrder"("status","nextReconcileAt");

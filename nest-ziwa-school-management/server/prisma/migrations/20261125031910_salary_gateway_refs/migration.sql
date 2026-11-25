-- AlterTable
ALTER TABLE "SalaryRun" ADD COLUMN     "callbackIdempotencyKey" TEXT,
ADD COLUMN     "providerRequestId" TEXT,
ADD COLUMN     "requestHash" TEXT NOT NULL;

-- CreateIndex
CREATE UNIQUE INDEX "SalaryRun_providerRequestId_key" ON "SalaryRun"("providerRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryRun_callbackIdempotencyKey_key" ON "SalaryRun"("callbackIdempotencyKey");

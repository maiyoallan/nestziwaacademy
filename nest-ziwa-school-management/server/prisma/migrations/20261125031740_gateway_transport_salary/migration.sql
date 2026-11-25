-- AlterTable
ALTER TABLE "Vehicle" ADD COLUMN     "name" TEXT,
ADD COLUMN     "routeId" TEXT,
ADD COLUMN     "schoolId" TEXT,
ADD COLUMN     "vehicleClass" TEXT NOT NULL DEFAULT 'BUS';

-- CreateTable
CREATE TABLE "PaymentPrompt" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentRecordId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "gatewayDriver" TEXT NOT NULL,
    "channel" "PaymentChannel" NOT NULL,
    "purpose" TEXT NOT NULL,
    "allocation" TEXT NOT NULL DEFAULT 'TUITION',
    "amount" DECIMAL(14,2) NOT NULL,
    "phone" TEXT NOT NULL,
    "explanation" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "providerRequestId" TEXT,
    "providerReference" TEXT,
    "callbackIdempotencyKey" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_PROMPT',
    "failureReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "settledPaymentId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentPrompt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "TransportAssignment" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentRecordId" TEXT NOT NULL,
    "vehicleId" TEXT NOT NULL,
    "routeId" TEXT,
    "assignedById" TEXT NOT NULL,
    "feeAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "billingCycle" TEXT NOT NULL DEFAULT 'TERM',
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "activeKey" TEXT,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMP(3),

    CONSTRAINT "TransportAssignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryRun" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "confirmedById" TEXT,
    "gatewayDriver" TEXT NOT NULL,
    "channel" "PaymentChannel" NOT NULL DEFAULT 'BANK_TRANSFER',
    "status" TEXT NOT NULL DEFAULT 'PENDING_CONFIRMATION',
    "totalAmount" DECIMAL(14,2) NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "providerReference" TEXT,
    "journalEntryId" TEXT,
    "failureReason" TEXT,
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SalaryRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SalaryPayment" (
    "id" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "staffRecordId" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL,
    "description" TEXT,

    CONSTRAINT "SalaryPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentPrompt_idempotencyKey_key" ON "PaymentPrompt"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentPrompt_providerRequestId_key" ON "PaymentPrompt"("providerRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentPrompt_providerReference_key" ON "PaymentPrompt"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentPrompt_callbackIdempotencyKey_key" ON "PaymentPrompt"("callbackIdempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentPrompt_settledPaymentId_key" ON "PaymentPrompt"("settledPaymentId");

-- CreateIndex
CREATE INDEX "PaymentPrompt_schoolId_status_createdAt_idx" ON "PaymentPrompt"("schoolId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentPrompt_studentRecordId_createdAt_idx" ON "PaymentPrompt"("studentRecordId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "TransportAssignment_activeKey_key" ON "TransportAssignment"("activeKey");

-- CreateIndex
CREATE INDEX "TransportAssignment_schoolId_status_vehicleId_idx" ON "TransportAssignment"("schoolId", "status", "vehicleId");

-- CreateIndex
CREATE INDEX "TransportAssignment_studentRecordId_status_idx" ON "TransportAssignment"("studentRecordId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryRun_idempotencyKey_key" ON "SalaryRun"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryRun_providerReference_key" ON "SalaryRun"("providerReference");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryRun_journalEntryId_key" ON "SalaryRun"("journalEntryId");

-- CreateIndex
CREATE INDEX "SalaryRun_schoolId_status_createdAt_idx" ON "SalaryRun"("schoolId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "SalaryPayment_runId_staffRecordId_key" ON "SalaryPayment"("runId", "staffRecordId");

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "TransportRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Vehicle" ADD CONSTRAINT "Vehicle_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPrompt" ADD CONSTRAINT "PaymentPrompt_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPrompt" ADD CONSTRAINT "PaymentPrompt_studentRecordId_fkey" FOREIGN KEY ("studentRecordId") REFERENCES "ModuleRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPrompt" ADD CONSTRAINT "PaymentPrompt_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentPrompt" ADD CONSTRAINT "PaymentPrompt_settledPaymentId_fkey" FOREIGN KEY ("settledPaymentId") REFERENCES "PaymentTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportAssignment" ADD CONSTRAINT "TransportAssignment_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportAssignment" ADD CONSTRAINT "TransportAssignment_studentRecordId_fkey" FOREIGN KEY ("studentRecordId") REFERENCES "ModuleRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportAssignment" ADD CONSTRAINT "TransportAssignment_vehicleId_fkey" FOREIGN KEY ("vehicleId") REFERENCES "Vehicle"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportAssignment" ADD CONSTRAINT "TransportAssignment_routeId_fkey" FOREIGN KEY ("routeId") REFERENCES "TransportRoute"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "TransportAssignment" ADD CONSTRAINT "TransportAssignment_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRun" ADD CONSTRAINT "SalaryRun_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRun" ADD CONSTRAINT "SalaryRun_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRun" ADD CONSTRAINT "SalaryRun_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryRun" ADD CONSTRAINT "SalaryRun_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_runId_fkey" FOREIGN KEY ("runId") REFERENCES "SalaryRun"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SalaryPayment" ADD CONSTRAINT "SalaryPayment_staffRecordId_fkey" FOREIGN KEY ("staffRecordId") REFERENCES "ModuleRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

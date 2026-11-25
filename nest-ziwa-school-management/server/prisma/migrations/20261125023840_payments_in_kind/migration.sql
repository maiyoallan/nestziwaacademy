-- CreateEnum
CREATE TYPE "PaymentChannel" AS ENUM ('MPESA_PAYBILL', 'AIRTEL_MONEY', 'CHEQUE', 'BANK_TRANSFER', 'CASH', 'IN_KIND', 'OTHER');

-- CreateEnum
CREATE TYPE "InKindItem" AS ENUM ('MAIZE', 'BEANS', 'MILLET', 'REAM_PAPER');

-- CreateTable
CREATE TABLE "PaymentTransaction" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentRecordId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "verifiedById" TEXT,
    "channel" "PaymentChannel" NOT NULL,
    "transactionCode" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "requestFingerprint" TEXT NOT NULL,
    "admissionNumber" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "amount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cashAmount" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "cashbook" TEXT NOT NULL DEFAULT 'BANK',
    "item" "InKindItem",
    "quantity" DECIMAL(14,3),
    "verifiedQuantity" DECIMAL(14,3),
    "unit" TEXT,
    "unitValue" DECIMAL(14,2),
    "inKindValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "deliveryReference" TEXT,
    "explanation" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "concern" TEXT,
    "statementReference" TEXT,
    "statementAmount" DECIMAL(14,2),
    "verificationNote" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "journalEntryId" TEXT,
    "paymentRecordId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaymentTransaction_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PaymentConcern" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "paymentId" TEXT,
    "channel" "PaymentChannel",
    "transactionCode" TEXT,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "createdById" TEXT NOT NULL,
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PaymentConcern_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InKindPledge" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "studentRecordId" TEXT NOT NULL,
    "createdById" TEXT NOT NULL,
    "admissionNumber" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "item" "InKindItem" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitValue" DECIMAL(14,2),
    "expectedAt" TIMESTAMP(3),
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'EXPECTED',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InKindPledge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "InKindMovement" (
    "id" TEXT NOT NULL,
    "schoolId" TEXT NOT NULL,
    "paymentId" TEXT NOT NULL,
    "studentRecordId" TEXT NOT NULL,
    "recordedById" TEXT NOT NULL,
    "admissionNumber" TEXT NOT NULL,
    "className" TEXT NOT NULL,
    "item" "InKindItem" NOT NULL,
    "quantity" DECIMAL(14,3) NOT NULL,
    "unit" TEXT NOT NULL,
    "unitValue" DECIMAL(14,2),
    "totalValue" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InKindMovement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_idempotencyKey_key" ON "PaymentTransaction"("idempotencyKey");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_journalEntryId_key" ON "PaymentTransaction"("journalEntryId");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_paymentRecordId_key" ON "PaymentTransaction"("paymentRecordId");

-- CreateIndex
CREATE INDEX "PaymentTransaction_schoolId_status_createdAt_idx" ON "PaymentTransaction"("schoolId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentTransaction_admissionNumber_createdAt_idx" ON "PaymentTransaction"("admissionNumber", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "PaymentTransaction_schoolId_channel_transactionCode_key" ON "PaymentTransaction"("schoolId", "channel", "transactionCode");

-- CreateIndex
CREATE INDEX "PaymentConcern_schoolId_status_createdAt_idx" ON "PaymentConcern"("schoolId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "PaymentConcern_transactionCode_channel_idx" ON "PaymentConcern"("transactionCode", "channel");

-- CreateIndex
CREATE INDEX "InKindPledge_schoolId_className_item_idx" ON "InKindPledge"("schoolId", "className", "item");

-- CreateIndex
CREATE INDEX "InKindPledge_admissionNumber_item_idx" ON "InKindPledge"("admissionNumber", "item");

-- CreateIndex
CREATE UNIQUE INDEX "InKindMovement_paymentId_key" ON "InKindMovement"("paymentId");

-- CreateIndex
CREATE INDEX "InKindMovement_schoolId_className_item_receivedAt_idx" ON "InKindMovement"("schoolId", "className", "item", "receivedAt");

-- CreateIndex
CREATE INDEX "InKindMovement_admissionNumber_item_idx" ON "InKindMovement"("admissionNumber", "item");

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_studentRecordId_fkey" FOREIGN KEY ("studentRecordId") REFERENCES "ModuleRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_journalEntryId_fkey" FOREIGN KEY ("journalEntryId") REFERENCES "JournalEntry"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_paymentRecordId_fkey" FOREIGN KEY ("paymentRecordId") REFERENCES "ModuleRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentConcern" ADD CONSTRAINT "PaymentConcern_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentConcern" ADD CONSTRAINT "PaymentConcern_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PaymentTransaction"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentConcern" ADD CONSTRAINT "PaymentConcern_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PaymentConcern" ADD CONSTRAINT "PaymentConcern_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InKindPledge" ADD CONSTRAINT "InKindPledge_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InKindPledge" ADD CONSTRAINT "InKindPledge_studentRecordId_fkey" FOREIGN KEY ("studentRecordId") REFERENCES "ModuleRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InKindPledge" ADD CONSTRAINT "InKindPledge_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InKindMovement" ADD CONSTRAINT "InKindMovement_schoolId_fkey" FOREIGN KEY ("schoolId") REFERENCES "School"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InKindMovement" ADD CONSTRAINT "InKindMovement_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "PaymentTransaction"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InKindMovement" ADD CONSTRAINT "InKindMovement_studentRecordId_fkey" FOREIGN KEY ("studentRecordId") REFERENCES "ModuleRecord"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InKindMovement" ADD CONSTRAINT "InKindMovement_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

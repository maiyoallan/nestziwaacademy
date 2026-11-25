-- AlterEnum
ALTER TYPE "UserRole" ADD VALUE 'EXAM_OFFICER';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustChangePassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "StudentAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "linkedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StudentAccount_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StudentPhoto" (
    "id" TEXT NOT NULL,
    "recordId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StudentPhoto_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SchoolAsset" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "mimeType" TEXT NOT NULL,
    "data" BYTEA NOT NULL,
    "createdById" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SchoolAsset_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "StudentAccount_userId_key" ON "StudentAccount"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentAccount_recordId_key" ON "StudentAccount"("recordId");

-- CreateIndex
CREATE UNIQUE INDEX "StudentPhoto_recordId_key" ON "StudentPhoto"("recordId");

-- CreateIndex
CREATE UNIQUE INDEX "SchoolAsset_key_key" ON "SchoolAsset"("key");

-- AddForeignKey
ALTER TABLE "StudentAccount" ADD CONSTRAINT "StudentAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentAccount" ADD CONSTRAINT "StudentAccount_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ModuleRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StudentPhoto" ADD CONSTRAINT "StudentPhoto_recordId_fkey" FOREIGN KEY ("recordId") REFERENCES "ModuleRecord"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SchoolAsset" ADD CONSTRAINT "SchoolAsset_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

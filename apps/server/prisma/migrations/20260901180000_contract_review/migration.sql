-- CreateEnum
CREATE TYPE "RiskSeverity" AS ENUM ('HIGH', 'MEDIUM', 'LOW');

-- CreateEnum
CREATE TYPE "ReviewStatus" AS ENUM ('RUNNING', 'DONE', 'FAILED');

-- CreateTable
CREATE TABLE "review_templates" (
    "id" TEXT NOT NULL,
    "contractType" TEXT,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_rules" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "detail" TEXT NOT NULL,
    "severity" "RiskSeverity" NOT NULL DEFAULT 'MEDIUM',
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "isDraft" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "review_rules_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "contract_reviews" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "templateId" TEXT,
    "status" "ReviewStatus" NOT NULL DEFAULT 'RUNNING',
    "model" TEXT,
    "error" TEXT,
    "elapsedMs" INTEGER,
    "redactedCount" INTEGER NOT NULL DEFAULT 0,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMP(3),

    CONSTRAINT "contract_reviews_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "review_findings" (
    "id" TEXT NOT NULL,
    "reviewId" TEXT NOT NULL,
    "ruleTitle" TEXT NOT NULL,
    "severity" "RiskSeverity" NOT NULL,
    "summary" TEXT NOT NULL,
    "evidence" TEXT NOT NULL,
    "suggestion" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "review_findings_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "review_templates_contractType_key" ON "review_templates"("contractType");

-- CreateIndex
CREATE INDEX "review_rules_templateId_sortOrder_idx" ON "review_rules"("templateId", "sortOrder");

-- CreateIndex
CREATE INDEX "contract_reviews_contractId_createdAt_idx" ON "contract_reviews"("contractId", "createdAt");

-- CreateIndex
CREATE INDEX "review_findings_reviewId_sortOrder_idx" ON "review_findings"("reviewId", "sortOrder");

-- AddForeignKey
ALTER TABLE "review_rules" ADD CONSTRAINT "review_rules_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "review_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_reviews" ADD CONSTRAINT "contract_reviews_contractId_fkey" FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_reviews" ADD CONSTRAINT "contract_reviews_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "review_templates"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "contract_reviews" ADD CONSTRAINT "contract_reviews_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "review_findings" ADD CONSTRAINT "review_findings_reviewId_fkey" FOREIGN KEY ("reviewId") REFERENCES "contract_reviews"("id") ON DELETE CASCADE ON UPDATE CASCADE;


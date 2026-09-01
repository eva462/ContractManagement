-- 审批流程：合同生命周期从「录入即生效」改成「审核 → 签署 → 归档 → 生效」
--
-- 注意 PENDING_FILING「待归档」和 CLOSED「已完结」是两个相反的概念：
-- 前者是纸件入档 + 扫描件上传（生效前的关口），后者是合同完结封存（终点）。
-- 详见 docs/design/03-审批流程与设置模块.md §1
--
-- 手写而非 prisma migrate diff 生成：自动生成的版本会在创建 closedFrom 列之前
-- 就去 ALTER 它，直接报错。这里的顺序是对的，并且用 RENAME 保住已有数据。

-- 1. 审批结论枚举
CREATE TYPE "ApprovalDecision" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- 2. 审计动作补四个（新值在本事务内不使用，PG 16 允许这么写）
ALTER TYPE "AuditAction" ADD VALUE 'SUBMIT';
ALTER TYPE "AuditAction" ADD VALUE 'APPROVE';
ALTER TYPE "AuditAction" ADD VALUE 'REJECT';
ALTER TYPE "AuditAction" ADD VALUE 'WITHDRAW';

-- 3. 先把列名改好，下一步转换枚举时才引用得到
ALTER TABLE "contracts" RENAME COLUMN "archivedFrom" TO "closedFrom";
ALTER TABLE "contracts" ADD COLUMN "signedDate" DATE;

-- 4. 换掉状态枚举。ARCHIVED 的语义等同新的 CLOSED，就地映射过去。
CREATE TYPE "ContractStatus_new" AS ENUM (
  'DRAFT', 'PENDING_APPROVAL', 'PENDING_SIGNING', 'PENDING_FILING',
  'ACTIVE', 'TERMINATED', 'CLOSED'
);

ALTER TABLE "contracts" ALTER COLUMN "status" DROP DEFAULT;

ALTER TABLE "contracts"
  ALTER COLUMN "status" TYPE "ContractStatus_new"
  USING (CASE WHEN "status"::text = 'ARCHIVED' THEN 'CLOSED' ELSE "status"::text END)::"ContractStatus_new";

ALTER TABLE "contracts"
  ALTER COLUMN "closedFrom" TYPE "ContractStatus_new"
  USING (CASE WHEN "closedFrom"::text = 'ARCHIVED' THEN 'CLOSED' ELSE "closedFrom"::text END)::"ContractStatus_new";

ALTER TYPE "ContractStatus" RENAME TO "ContractStatus_old";
ALTER TYPE "ContractStatus_new" RENAME TO "ContractStatus";
DROP TYPE "ContractStatus_old";

ALTER TABLE "contracts" ALTER COLUMN "status" SET DEFAULT 'DRAFT';

-- 5. 审批节点表
CREATE TABLE "contract_approvals" (
    "id" TEXT NOT NULL,
    "contractId" TEXT NOT NULL,
    "seq" INTEGER NOT NULL,
    "approverId" TEXT,
    "decision" "ApprovalDecision" NOT NULL DEFAULT 'PENDING',
    "comment" TEXT,
    "decidedById" TEXT,
    "decidedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "contract_approvals_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "contract_approvals_contractId_seq_idx" ON "contract_approvals"("contractId", "seq");
CREATE INDEX "contract_approvals_decision_idx" ON "contract_approvals"("decision");

-- 合同删了审批节点跟着删；引用用户的外键用 Restrict，避免删用户把审批历史抹掉
ALTER TABLE "contract_approvals"
  ADD CONSTRAINT "contract_approvals_contractId_fkey"
  FOREIGN KEY ("contractId") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "contract_approvals"
  ADD CONSTRAINT "contract_approvals_approverId_fkey"
  FOREIGN KEY ("approverId") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "contract_approvals"
  ADD CONSTRAINT "contract_approvals_decidedById_fkey"
  FOREIGN KEY ("decidedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

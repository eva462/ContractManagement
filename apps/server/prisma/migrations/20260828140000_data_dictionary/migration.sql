-- 数据字典：把合同类型这类原本写死在代码里的枚举挪进数据库，让管理员自己维护。
--
-- contractType 从数据库枚举改成字符串（引用 dict_items.itemCode）。
-- 已有数据的值不变（PURCHASE、SALES…），所以 USING 直接转文本即可。

-- 1. 字典表
CREATE TABLE "dict_items" (
    "id" TEXT NOT NULL,
    "dictCode" TEXT NOT NULL,
    "itemCode" TEXT NOT NULL,
    "itemLabel" TEXT NOT NULL,
    "prefix" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "dict_items_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "dict_items_dictCode_itemCode_key" ON "dict_items"("dictCode", "itemCode");
CREATE INDEX "dict_items_dictCode_isActive_sortOrder_idx" ON "dict_items"("dictCode", "isActive", "sortOrder");

-- 2. 合同类型：枚举 → 字符串。索引要先删，改完再建。
DROP INDEX IF EXISTS "contracts_contractType_idx";

ALTER TABLE "contracts"
  ALTER COLUMN "contractType" TYPE TEXT USING "contractType"::text;

CREATE INDEX "contracts_contractType_idx" ON "contracts"("contractType");

-- 3. 枚举类型不再被引用，删掉。留着会让人误以为它还是权威来源。
DROP TYPE IF EXISTS "ContractType";

-- 4. 字典的增删改也要留痕，审计实体类型补一个
ALTER TYPE "AuditEntityType" ADD VALUE 'DICT';

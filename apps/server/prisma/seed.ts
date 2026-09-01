import { PrismaClient } from '@prisma/client'
import { hashPassword } from '../src/auth/password.js'

const db = new PrismaClient()

/** 相对今天算日期，让「即将到期 / 已过期」这两个派生态在任何时候跑种子都成立。 */
function daysFromNow(n: number): Date {
  const d = new Date()
  d.setUTCHours(0, 0, 0, 0)
  d.setUTCDate(d.getUTCDate() + n)
  return d
}

const SEED_USERS = [
  { username: 'admin', displayName: '管理员', role: 'ADMIN' as const },
  { username: 'manager', displayName: '李经理', role: 'MANAGER' as const },
  { username: 'staff', displayName: '张三', role: 'STAFF' as const },
]

const DEFAULT_PASSWORD = 'admin123'

async function main(): Promise<void> {
  const existing = await db.user.count()
  if (existing > 0) {
    console.log(`数据库里已有 ${existing} 个用户，跳过种子数据。`)
    console.log('要重来一次：npm run db:reset && npm run db:migrate && npm run db:seed')
    return
  }

  const passwordHash = await hashPassword(DEFAULT_PASSWORD)
  const users: Record<string, { id: string; displayName: string }> = {}

  for (const u of SEED_USERS) {
    const created = await db.user.create({
      data: { ...u, passwordHash },
      select: { id: true, username: true, displayName: true },
    })
    users[u.username] = created
  }

  const admin = users.admin!
  const manager = users.manager!
  const staff = users.staff!

  // 示例合同刻意覆盖全部 4 个存储状态 + 4 种到期派生态，
  // 这样一进台账就能看到红黄标、只读归档、终止等各种情况长什么样。
  const samples = [
    {
      contractNo: 'CG-2026-0001',
      title: '办公家具采购合同',
      contractType: 'PURCHASE' as const,
      counterpartyName: '优家办公家具有限公司',
      counterpartyContact: '王采购',
      amountType: 'TAX_INCLUDED' as const,
      amount: '128600.00',
      currency: 'CNY' as const,
      paymentTerms: '合同签订后预付 30%，验收合格后 15 个工作日内付清余款',
      signDate: daysFromNow(-120),
      effectiveDate: daysFromNow(-120),
      expiryDate: daysFromNow(240),
      isPerpetual: false,
      ownerId: staff.id,
      status: 'ACTIVE' as const,
      originalLocation: '行政部档案柜 A-03',
      remark: '含 3 年质保',
    },
    {
      contractNo: 'FW-2026-0001',
      title: '公司官网运维服务合同',
      contractType: 'SERVICE' as const,
      counterpartyName: '蓝海网络科技有限公司',
      counterpartyContact: '陈工',
      amountType: 'TAX_EXCLUDED' as const,
      amount: '48000.00',
      currency: 'CNY' as const,
      paymentTerms: '按季度付款，每季度首月 10 日前支付',
      signDate: daysFromNow(-350),
      effectiveDate: daysFromNow(-350),
      expiryDate: daysFromNow(15), // 触发「即将到期」黄标
      isPerpetual: false,
      ownerId: staff.id,
      status: 'ACTIVE' as const,
      originalLocation: '行政部档案柜 A-05',
    },
    {
      contractNo: 'XS-2026-0001',
      title: 'ERP 系统销售合同',
      contractType: 'SALES' as const,
      counterpartyName: '恒瑞制造集团股份有限公司',
      counterpartyContact: '刘总',
      amountType: 'TAX_INCLUDED' as const,
      amount: '860000.00',
      currency: 'CNY' as const,
      paymentTerms: '首付 40%，上线验收 50%，质保金 10% 满 12 个月付清',
      signDate: daysFromNow(-420),
      effectiveDate: daysFromNow(-400),
      expiryDate: daysFromNow(-20), // 触发「已过期」红标
      isPerpetual: false,
      ownerId: manager.id,
      status: 'ACTIVE' as const,
      originalLocation: '行政部档案柜 B-01',
    },
    {
      contractNo: 'BM-2026-0001',
      title: '双方保密协议（NDA）',
      contractType: 'NDA' as const,
      counterpartyName: '星辰咨询（上海）有限公司',
      amountType: 'NO_AMOUNT' as const,
      amount: null,
      currency: 'CNY' as const,
      signDate: daysFromNow(-60),
      effectiveDate: daysFromNow(-60),
      expiryDate: null,
      isPerpetual: true, // 长期有效
      ownerId: manager.id,
      status: 'ACTIVE' as const,
    },
    {
      contractNo: null, // 草稿允许没有编号
      title: '新仓库租赁合同（待完善）',
      contractType: 'LEASE' as const,
      counterpartyName: null,
      amountType: null,
      amount: null,
      currency: 'CNY' as const,
      signDate: null,
      effectiveDate: null,
      expiryDate: null,
      isPerpetual: false,
      ownerId: staff.id,
      status: 'DRAFT' as const,
      remark: '等对方报价后补齐',
    },
    {
      contractNo: 'ZL-2026-0001',
      title: '旧办公室租赁合同',
      contractType: 'LEASE' as const,
      counterpartyName: '中天置业管理有限公司',
      amountType: 'TAX_INCLUDED' as const,
      amount: '240000.00',
      currency: 'CNY' as const,
      signDate: daysFromNow(-700),
      effectiveDate: daysFromNow(-690),
      expiryDate: daysFromNow(30),
      isPerpetual: false,
      ownerId: manager.id,
      status: 'TERMINATED' as const,
      terminatedAt: daysFromNow(-45),
      terminationReason: '公司整体搬迁，双方协商一致提前解除租约',
    },
    {
      contractNo: 'LW-2026-0001',
      title: '展会临时劳务合同',
      contractType: 'LABOR' as const,
      counterpartyName: '广聚人力资源服务有限公司',
      amountType: 'TAX_EXCLUDED' as const,
      amount: '36000.00',
      currency: 'CNY' as const,
      signDate: daysFromNow(-500),
      effectiveDate: daysFromNow(-500),
      expiryDate: daysFromNow(-300),
      isPerpetual: false,
      ownerId: staff.id,
      status: 'CLOSED' as const,
      closedFrom: 'ACTIVE' as const,
    },
  ]

  for (const s of samples) {
    await db.$transaction(async (tx) => {
      const c = await tx.contract.create({
        data: { ...s, createdById: admin.id, updatedById: admin.id },
      })
      await tx.auditLog.create({
        data: {
          entityType: 'CONTRACT',
          entityId: c.id,
          action: 'CREATE',
          userId: admin.id,
          userName: admin.displayName,
          summary: `${admin.displayName} 创建了合同「${c.title}」（示例数据）`,
          changes: undefined,
        },
      })
    })
  }

  console.log('种子数据已写入：')
  console.log('')
  for (const u of SEED_USERS) {
    console.log(`  ${u.username.padEnd(8)} / ${DEFAULT_PASSWORD}   ${u.displayName}（${u.role}）`)
  }
  console.log('')
  console.log(`  示例合同 ${samples.length} 条，覆盖草稿 / 履行中 / 已终止 / 已归档，`)
  console.log('  以及正常 / 即将到期 / 已过期 / 长期有效四种到期展示。')
}

main()
  .catch((e) => {
    console.error(e)
    process.exit(1)
  })
  .finally(() => db.$disconnect())

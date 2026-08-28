#!/usr/bin/env node
/**
 * 临时对外演示：把整套系统通过一条隧道暴露到公网，用完即关。
 *
 *   npm run demo:start -w apps/server     开始
 *   npm run demo:end   -w apps/server     结束（还原开发密码）
 *
 * 做了三件事，缺一不可：
 *   1. 单源打包 —— 后端同时托管前端，API 走相对路径。
 *      不这么做的话，别人打开链接后浏览器会去调「他自己的 localhost」，直接坏掉。
 *   2. 换掉种子弱密码 —— admin123 在公网上活不过几分钟。
 *      改成随机强密码，原始哈希存起来，结束时还原。
 *   3. 临时 JWT 密钥 —— 只存在于本次进程的环境变量里，不写进 .env。
 *      顺带让之前签发的所有 token 立即失效。
 *
 * ⚠️ 这是临时演示用的，不是部署方案。用完请立刻 Ctrl+C 并跑 demo:end。
 */
import { spawn, spawnSync } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync, readFileSync, writeFileSync, unlinkSync, mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { createInterface } from 'node:readline'

const here = dirname(fileURLToPath(import.meta.url))
const serverRoot = resolve(here, '..')
const repoRoot = resolve(here, '../../..')
const distDir = resolve(repoRoot, 'apps/web/dist')
const stateFile = resolve(repoRoot, 'var/demo-state.json')

const C = {
  b: (s) => `\x1b[1m${s}\x1b[0m`,
  dim: (s) => `\x1b[90m${s}\x1b[0m`,
  g: (s) => `\x1b[32m${s}\x1b[0m`,
  y: (s) => `\x1b[33m${s}\x1b[0m`,
  r: (s) => `\x1b[31m${s}\x1b[0m`,
  c: (s) => `\x1b[36m${s}\x1b[0m`,
}

const DEMO_ACCOUNTS = ['admin', 'manager', 'staff']
const PORT = Number(process.env.DEMO_PORT ?? 3200)

/** 好念、好转述的随机密码 —— 演示时要口头报给同事 */
function makePassword() {
  const words = ['tiger', 'maple', 'river', 'stone', 'cloud', 'amber', 'quartz', 'cedar']
  const w = () => words[randomBytes(1)[0] % words.length]
  return `${w()}-${w()}-${randomBytes(2).toString('hex')}`
}

async function main() {
  const mode = process.argv[2] === 'end' ? 'end' : 'start'
  const { db } = await import('../src/db.ts')
  const { hashPassword } = await import('../src/auth/password.ts')

  if (mode === 'end') {
    console.log(C.b('\n收尾检查\n'))
    let clean = true

    /* 1. 公网入口是否真的关了 —— 这是最要紧的一条。
     *    只关服务窗口不够：隧道还在，门还开着，只是里面没人。
     *
     *    查 ngrok 的本地 API 拿到隧道实际转发的地址，只对准演示端口的报警。
     *    机器上可能同时有别的项目在用 ngrok，不该一竿子打翻。 */
    let tunnels = null
    try {
      const res = await fetch('http://127.0.0.1:4040/api/tunnels', { signal: AbortSignal.timeout(1500) })
      tunnels = (await res.json()).tunnels ?? []
    } catch {
      tunnels = null // ngrok 没跑，或者没开本地管理接口
    }

    if (tunnels === null) {
      console.log(C.g('  ✓ 没有检测到 ngrok，公网入口已关闭'))
    } else {
      const mine = tunnels.filter((t) => String(t.config?.addr ?? '').includes(`:${PORT}`))
      const others = tunnels.filter((t) => !String(t.config?.addr ?? '').includes(`:${PORT}`))
      if (mine.length > 0) {
        clean = false
        console.log(C.r('  ✗ 演示隧道还开着，公网仍然可以访问：'))
        for (const t of mine) console.log(C.r(`      ${t.public_url}`))
        console.log(C.dim('      去 ngrok 那个窗口按 Ctrl+C'))
      } else {
        console.log(C.g('  ✓ 没有指向演示端口的隧道，公网入口已关闭'))
      }
      // 别的项目的隧道只提示一句，不算收尾没做完
      for (const t of others) {
        console.log(C.dim(`  · 另有隧道（与本项目无关）：${t.public_url} → ${t.config.addr}`))
      }
    }

    /* 2. 演示服务进程 */
    let alive = false
    try {
      alive = (await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(1200) })).ok
    } catch {
      /* 关了就是关了 */
    }
    if (alive) {
      clean = false
      console.log(C.y(`  ! 演示服务还在 :${PORT} 上跑（没有隧道的话只有本机能访问）`))
    } else {
      console.log(C.g(`  ✓ 演示服务已停止（:${PORT} 无响应）`))
    }

    /* 3. 还原密码 */
    if (!existsSync(stateFile)) {
      console.log(C.dim('  · 没有待还原的密码状态'))
    } else {
      const state = JSON.parse(readFileSync(stateFile, 'utf8'))
      for (const [username, passwordHash] of Object.entries(state.originalHashes)) {
        await db.user.update({ where: { username }, data: { passwordHash } })
      }
      await db.refreshToken.deleteMany({}) // 演示期间发出去的会话一律作废
      console.log(C.g('  ✓ 已还原开发密码，演示期间的会话全部作废'))

      /* 4. 演示期间发生了什么 —— 让你自己判断要不要清理 */
      const since = new Date(state.startedAt)
      const [logs, newContracts, newFiles] = await Promise.all([
        db.auditLog.groupBy({
          by: ['action'],
          where: { createdAt: { gte: since } },
          _count: true,
        }),
        db.contract.count({ where: { createdAt: { gte: since } } }),
        db.contractAttachment.count({ where: { uploadedAt: { gte: since } } }),
      ])
      const extractCount = logs.find((l) => l.action === 'EXTRACT')?._count ?? 0

      console.log('\n' + C.b('  演示期间产生的数据') + C.dim('（都还在你本机，要不要清自己定）'))
      console.log(`    新建合同  ${newContracts} 份`)
      console.log(`    上传附件  ${newFiles} 个   ${C.dim('→ var/uploads/')}`)
      console.log(
        `    内容识别  ${extractCount} 次  ${C.dim(extractCount > 0 ? `≈ ¥${(extractCount * 0.02).toFixed(2)} DeepSeek 费用` : '（没人用过识别）')}`,
      )
      if (logs.length > 0) {
        console.log(
          C.dim(`    全部操作：${logs.map((l) => `${l.action} ${l._count}`).join('  ')}`),
        )
      }
      unlinkSync(stateFile)
    }

    console.log()
    if (clean) {
      console.log(C.g('  公网入口已关闭，密码已还原。'))
      console.log(
        C.dim('  DeepSeek key 不需要换 —— 它只在后端用，前端和访客都拿不到，没有泄露途径。'),
      )
    } else {
      console.log(C.r('  上面标红的项还没处理完，公网可能仍然可达。'))
    }
    console.log()
    await db.$disconnect()
    return
  }

  /* ── 开始演示 ─────────────────────────────────────────────────── */

  console.log(C.b('\n准备临时演示环境\n'))

  // 1. 单源打包：VITE_API_BASE_URL 置空 → 前端走相对路径 /api/v1
  process.stdout.write('  1/3  打包前端（单源模式）… ')
  const build = spawnSync('npm', ['run', 'build', '-w', 'apps/web'], {
    cwd: repoRoot,
    shell: process.platform === 'win32',
    env: { ...process.env, VITE_API_BASE_URL: '' },
    stdio: 'pipe',
  })
  if (build.status !== 0) {
    console.log(C.r('失败'))
    console.log(String(build.stderr || build.stdout))
    process.exit(1)
  }
  const indexJs = existsSync(distDir)
  if (!indexJs) {
    console.log(C.r('失败：没有生成 dist'))
    process.exit(1)
  }
  console.log(C.g('好'))

  // 2. 换掉弱密码
  process.stdout.write('  2/3  更换演示密码… ')
  const users = await db.user.findMany({
    where: { username: { in: DEMO_ACCOUNTS } },
    select: { username: true, passwordHash: true },
  })
  if (users.length === 0) {
    console.log(C.r('失败：库里没有种子账号，先跑 npm run db:seed'))
    process.exit(1)
  }
  const originalHashes = Object.fromEntries(users.map((u) => [u.username, u.passwordHash]))
  const creds = {}
  for (const u of users) {
    const pw = makePassword()
    creds[u.username] = pw
    await db.user.update({ where: { username: u.username }, data: { passwordHash: await hashPassword(pw) } })
  }
  await db.refreshToken.deleteMany({}) // 旧会话作废，免得有人拿着旧 token
  mkdirSync(dirname(stateFile), { recursive: true })
  writeFileSync(stateFile, JSON.stringify({ originalHashes, startedAt: new Date().toISOString() }, null, 2))
  console.log(C.g('好'))

  // 3. 起服务（单源 + 临时密钥 + 信任反代）
  process.stdout.write('  3/3  启动服务… ')
  const child = spawn('npx', ['tsx', 'src/index.ts'], {
    cwd: serverRoot,
    shell: process.platform === 'win32',
    env: {
      ...process.env,
      PORT: String(PORT),
      SERVE_WEB_DIR: distDir,
      TRUST_PROXY: 'true',
      // 临时密钥只活在这个进程里，不写进 .env
      JWT_SECRET: randomBytes(32).toString('hex'),
      CORS_ORIGIN: '*', // 同源了，其实用不上，留着以防万一
    },
    stdio: 'inherit',
  })

  // 等健康检查通过
  let up = false
  for (let i = 0; i < 40; i++) {
    try {
      if ((await fetch(`http://127.0.0.1:${PORT}/health`, { signal: AbortSignal.timeout(1000) })).ok) {
        up = true
        break
      }
    } catch {
      /* 还没起来 */
    }
    await new Promise((r) => setTimeout(r, 500))
  }
  if (!up) {
    console.log(C.r('失败：服务没起来'))
    child.kill()
    process.exit(1)
  }
  console.log(C.g('好\n'))

  console.log(C.b('  演示账号') + C.dim('（口头报给同事，别贴在群里）'))
  for (const [u, p] of Object.entries(creds)) {
    const role = { admin: '系统管理员', manager: '合同管理员', staff: '经办人' }[u]
    console.log(`    ${u.padEnd(9)} ${C.c(p.padEnd(24))} ${C.dim(role)}`)
  }

  console.log('\n' + C.b('  下一步：另开一个终端跑'))
  console.log(C.c(`    ngrok http ${PORT}`))
  console.log(C.dim('    ngrok 给出的 https 地址就是发给同事的链接。'))
  console.log(C.dim('    免费版首次打开会有一个 ngrok 提示页，点 Visit Site 继续即可。'))

  console.log('\n' + C.y('  演示结束后：'))
  console.log(C.dim('    1. 关掉 ngrok'))
  console.log(C.dim('    2. 在这里按 Ctrl+C'))
  console.log(C.dim('    3. 跑 npm run demo:end -w apps/server  还原开发密码'))
  console.log()
  console.log(C.dim('  提醒：内容识别是开着的，能登录的人都能传文件消耗你的 DeepSeek 额度'))
  console.log(C.dim('        （单份约 ¥0.02，短时间演示影响不大）。'))
  console.log()

  const rl = createInterface({ input: process.stdin, output: process.stdout })
  rl.on('SIGINT', () => {
    console.log('\n' + C.y('  正在关闭…别忘了跑 npm run demo:end -w apps/server 还原密码'))
    child.kill()
    rl.close()
    process.exit(0)
  })
}

main().catch((err) => {
  console.error(C.r('\n出错：'), err)
  process.exit(1)
})

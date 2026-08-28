# 合同管理系统

公司内部自用的合同台账系统。当前处于**本地开发阶段**，不含生产部署与移动端发布。

已实现两条闭环：

1. **手工录入合同 → 合同台账 → 查看/编辑 → 上传附件 → 操作留痕**
2. **上传合同文件 → AI 识别字段 → 预填表单 → 人工核对 → 保存**（可选，需配 DeepSeek key）

## 快速开始

需要 **Node 20.19+** 和 **Docker Desktop**（要先把 Docker 跑起来，数据库跑在容器里）。

```bash
cp .env.example .env
npm install
npm run setup      # 起 Postgres 容器 + 建表 + 灌种子数据
npm run dev        # 同时起后端 :3100 和前端 :5273
```

打开 http://localhost:5273

种子账号（密码均 `admin123`）：

| 账号 | 角色 | 能做什么 |
|---|---|---|
| `admin` | 系统管理员 | 全部权限，含解除归档、用户管理 |
| `manager` | 合同管理员 | 编辑全部合同、终止、归档 |
| `staff` | 经办人 | 建合同、编辑自己经办的、查看全部 |

### 开启内容识别（可选）

支持两家，在 `.env` 里填任意一家的 key 即可：

```
DEEPSEEK_API_KEY=你的key          # DeepSeek
DASHSCOPE_API_KEY=你的key         # 通义千问（阿里云百炼）
```

两家都配了的话，用 `EXTRACTION_PROVIDER=deepseek|qwen` 指定跑哪家；留空则自动挑一个。

一个 key 都不填 → 识别功能整个关闭，新建页不显示识别入口，手工录入不受任何影响。

> 开启后，用于识别的**合同原件会上传到对应厂商的服务器**。不希望出网的合同请直接手工录入。

`.env` 里的模型名只是写代码时的当前型号，各家改名换代很快——以你控制台里实际可用的为准，改 `.env` 即可，不用动代码。

### 对比两家的识别准确率

```bash
npm run compare -w apps/server -- ./合同1.pdf ./合同2.jpg
```

两家跑同一批文件，并排列出每个字段，标出**不一致**的地方——那几处就是需要翻原件核对的。两家共用同一套提示词和归一化逻辑，所以差异来自模型本身。

## 常用命令

| 命令 | 说明 |
|---|---|
| `npm run dev` | 同时起前后端 |
| `npm run dev:server` / `npm run dev:web` | 单独起某一端 |
| `npm run db:up` / `db:down` | 起停数据库容器 |
| `npm run db:reset` | **清库重来**（删卷重建，数据全没） |
| `npm run db:migrate` | 生成并应用迁移 |
| `npm run db:seed` | 灌种子数据（库里已有用户则跳过） |
| `npm run db:studio` | 开 Prisma Studio 看数据 |
| `npm run typecheck` | 前后端类型检查 |
| `npm run smoke -w apps/server` | 模块一接口冒烟测试（76 项，需先起服务） |
| `npm run test:normalize -w apps/server` | 金额/日期归一化单测（25 项） |
| `npm run test:extraction -w apps/server` | 内容识别端到端测试（34 项，用假识别服务，不出网） |
| `npm run compare -w apps/server -- <文件...>` | 用同一批合同对比各家识别准确率（**会把文件发到厂商服务器**） |
| `npm run sample -w apps/server` | 生成两份已知答案的样本合同（电子版 + 扫描件） |
| `npm run bench:parse -w apps/server` | 量本地 PDF 解析耗时（纯本地，不花钱） |
| `npm run verify:live -w apps/server` | 用样本合同做**真实调用**验准确率，逐字段对答案（**会真实计费**） |

清库重来的完整流程：

```bash
npm run db:reset && npm run db:migrate && npm run db:seed
```

## 临时对外演示

给同事看几小时的演示用。**这不是部署方案**，用完立刻关。

```bash
npm run demo:start -w apps/server    # 单源打包 + 换随机强密码 + 起服务(:3200)
ngrok http 3200                      # 另开一个终端
```

结束后：关掉 ngrok，在第一个终端按 Ctrl+C，然后

```bash
npm run demo:end -w apps/server      # 还原开发密码，作废演示期间的会话
```

脚本会做三件事，缺一不可：

1. **单源打包** —— 后端同时托管前端，API 走相对路径。不这么做的话，别人打开链接后浏览器会去调「他自己的 localhost」，直接坏掉。
2. **换掉种子弱密码** —— `admin123` 在公网上活不过几分钟。换成随机强密码并打印出来（口头报给同事，别贴群里）。
3. **临时 JWT 密钥** —— 只活在演示进程的环境变量里，不写进 `.env`；顺带作废所有已签发的 token。

⚠️ 演示期间内容识别是开着的，能登录的人都能传文件消耗 DeepSeek 额度（单份约 ¥0.02）。不想开就先把 `.env` 里的 `DEEPSEEK_API_KEY` 注掉——识别入口会自动隐藏，其余功能不受影响。

## 目录结构

```
├─ docker-compose.yml       只有 postgres:16
├─ .env                     前后端共用一份配置（gitignored）
├─ docs/design/             设计文档，每个模块一份
├─ packages/shared/         ★ 前后端唯一接口契约：枚举 / 常量 / Zod schema
├─ apps/server/             Fastify + Prisma
│  ├─ prisma/schema.prisma
│  ├─ src/types.ts          跨模块通用类型（Actor / ActingUser / RequestMeta）
│  ├─ src/extraction/       内容识别：本地文档解析 + 各家模型调用
│  └─ scripts/              冒烟测试、单测
├─ apps/web/                Vite + React + Tailwind
└─ var/uploads/             本地附件存储（gitignored）
```

## 四个可替换边界

后面要接云存储、换认证、改 API 地址、换识别服务时，只改这几个文件，业务代码不动：

| 边界 | 接口 | 当前实现 | 装配点 |
|---|---|---|---|
| **认证方式** | `apps/server/src/auth/provider.ts` | `auth/local.ts`（scrypt + JWT） | `apps/server/src/context.ts` |
| **附件存储** | `apps/server/src/storage/provider.ts` | `storage/local-disk.ts`（内容寻址去重） | `apps/server/src/context.ts` |
| **字段识别** | `apps/server/src/extraction/provider.ts` | `extraction/providers.ts`（DeepSeek / 通义千问） | `apps/server/src/context.ts` |
| **API 地址** | — | `apps/web/src/config.ts` 读 `VITE_API_BASE_URL` | 改 `.env` 即可 |
| **Token 存储** | `apps/web/src/auth/tokenStore.ts` | `localStorage` | 同文件 |

`context.ts` 是服务端唯一 `new` 具体实现的地方，路由和服务层只依赖接口。

## 几条不要绕过的约定

- **金额全程用字符串传输**，数据库里是 `DECIMAL(18,2)`。JSON 的 number 是双精度浮点，`123456789.15` 往返一次就会变形。
- **日期在网络上一律是 `'YYYY-MM-DD'` 字符串**，只在写库前转 `Date`。这样不用处理时区。
- **「已到期」不是存储状态**，由 `expiryDate` 实时派生（`computeExpiryState`）。所以不需要定时任务，也不会有「状态和日期对不上」的脏数据。存储状态只有 `DRAFT / ACTIVE / TERMINATED / ARCHIVED` 四个。
- **审计日志和业务写入必须在同一事务**。`writeAudit()` 只接受事务客户端 `Tx`，用类型把这条焊死了。
- **审计日志只增不改不删**。应用层没有 UPDATE/DELETE 接口，数据库层另有触发器兜底（见 init 迁移末尾）。因此引用 `audit_logs` 的外键必须是 `Restrict` 而不是 Prisma 默认的 `SetNull`。
- **只有草稿能删。** 其他状态一律只能归档。归档后对所有人只读，ADMIN 也要先解除归档才能改。
- **前端隐藏按钮不算权限**，后端每个接口都会再判一次。
- **AI 识别的结果永远不直接入库。** 只用来预填表单，人核对后走和手工录入完全相同的接口和校验。
- **本地 PDF 解析不是瓶颈，别在这里做优化。** 实测 20 页电子版抽文本 72ms、扫描件渲染切块 2.5s，而一次模型调用要 10–40 秒。想让识别变快只能换模型，拆页并行省不出东西（`npm run bench:parse`）。
- **PDF 解析、渲染、切块永远在本地做**（`extraction/document-loader.ts`），刻意不放进可替换边界 —— 换 AI 供应商时这部分完全不受影响。
- **模型返回值一律本地逐字段校验**。DeepSeek 的 JSON 模式不支持传 schema 强制，所以单个字段不合规就丢掉那个字段，不让整份结果作废。
- **提示词和归一化逻辑各家共用**（`extraction/prompt.ts`、`extraction/parse.ts`），不要给某一家单独调提示词——否则对比准确率时，比的就不是模型本身了。
- **提示词里的 JSON 示例会被模型当成字段白名单。** 实测过：示例里只写了 8 个字段时，模型就只输出那 8 个，另外 3 个明明在原文里也不给（准确率 73%）。改成「先用表格列全 13 个字段 + 明说示例只是演示格式」之后升到 100%。以后加字段，**示例和字段表两处都要改**。
- **跨模块通用类型放 `src/types.ts`，用户映射放 `modules/user/mapper.ts`。** 别再塞进 `modules/contract/` —— 那会让 attachment、user、审批流反过来依赖合同模块，把它变成谁都拆不走的地基。

## 文档

- [总体设计](docs/design/00-总体设计.md) — 候选设计，未冻结
- [01 · 合同主数据模块](docs/design/01-合同主数据模块.md) — 字段、状态、权限、验收标准
- [02 · 合同内容识别](docs/design/02-合同内容识别.md) — DeepSeek 接入、两段式流水线、识别字段与验收标准

## 当前不做

云服务器 · 域名 · HTTPS · Cloudflare Tunnel · TestFlight / Apple Business · Capacitor 打包 · 生产 CI/CD · 定时任务 · 邮件与推送。

**用户管理界面和审批流程是下一个模块**（两者耦合，一起做）。

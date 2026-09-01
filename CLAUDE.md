# 合同管理系统

公司内部自用的合同台账系统。**当前处于本地开发阶段**，不含生产部署与移动端发布。

已实现两条闭环：手工录入 → 台账 → 查看/编辑 → 附件 → 留痕；以及上传合同 → AI 识别 → 预填表单 → 人工核对 → 保存。

## 跑起来

需要 Node 20.19+ 和 **Docker Desktop（要先启动）**。

```bash
cp .env.example .env
npm install          # postinstall 会自动 prisma generate
npm run setup        # 起 Postgres 容器 + 建表 + 灌种子
npm run dev          # 后端 :3100，前端 :5273
```

种子账号 `admin` / `manager` / `staff`，密码都是 `admin123`。

内容识别是可选的：`.env` 里填 `DEEPSEEK_API_KEY` 才启用，不填则识别入口自动隐藏，其余功能完全不受影响。

## 技术栈

npm workspaces 单仓库 · Vite + React 19 + Tailwind v4（前端）· Fastify 5 + Prisma 6（后端）· PostgreSQL 16（Docker）· Zod 契约放 `packages/shared`。

## 架构约束（改动前必读）

- **`packages/shared` 是前后端唯一契约。** 枚举、常量、Zod schema、格式化函数都在这。改了字段前端会立刻编译报错——这是设计如此，别绕过。
- **四个可替换边界**，实现只在 `apps/server/src/context.ts` 里 `new`，路由和服务层只依赖接口：
  | 边界 | 接口 |
  |---|---|
  | 认证 | `src/auth/provider.ts` |
  | 附件存储 | `src/storage/provider.ts` |
  | 字段识别 | `src/extraction/provider.ts` |
  | API 地址 | `apps/web/src/config.ts` 读 `VITE_API_BASE_URL` |
- **跨模块通用类型放 `src/types.ts`，用户映射放 `modules/user/mapper.ts`。** 别塞进 `modules/contract/`——那会让别的模块反过来依赖合同模块。
- **业务模块之间无循环依赖。** 都单向指向 `audit`，`audit` 不反向依赖任何模块。

## 不要绕过的约定

- **金额全程用字符串传输**，库里是 `DECIMAL(18,2)`。JSON 的 number 是双精度浮点，`123456789.15` 往返一次就变形。
- **日期在网络上一律 `'YYYY-MM-DD'` 字符串**，只在写库前转 `Date`。这样不用处理时区。
- **「已到期」不是存储状态**，由 `expiryDate` 实时派生（`computeExpiryState`）。所以不需要定时任务，也不会有「状态和日期对不上」的脏数据。
- **合同生命周期有 7 个状态**：`DRAFT → PENDING_APPROVAL → PENDING_SIGNING → PENDING_FILING → ACTIVE`，外加 `TERMINATED` 和 `CLOSED`。
- **`PENDING_FILING`「待归档」和 `CLOSED`「已完结」是两个相反的概念**，别混。前者是纸件入档 + 扫描件上传，是**生效前的关口**；后者是合同完结封存，是**终点**。业务上都叫「归档」，代码里刻意用了两个词。
- **「待归档 → 履行中」有双条件闸门**：至少一个「合同正本」附件 + 填了原件存放位置。这是整套流程的价值所在，别为了图方便绕开。
- **审批回避写死在权限里**：经办人不能审自己提交的合同，角色再高也不行（`forbidOwner`）。
- **状态流转规则全在 `packages/shared/src/constants.ts` 的 `CONTRACT_ACTIONS` 一张表里**。加状态或改规则改这张表，别在服务层散写 if。
- **合同类型不是枚举，是数据库字典**（`dict_items`，`dictCode=CONTRACT_TYPE`）。`CONTRACT_TYPE_SEED_*` 那几个常量**只用于灌种子和识别提示词**，不要拿来做校验或渲染下拉框——那样管理员新增的类型就认不到。前端用 `useDict()`，后端用 `assertValidDictItem()`。
- **合同编号前缀跟着字典项走**（采购→CG）。管理员改了前缀，新编号立刻跟着变，已有编号不动。
- **被引用过的字典项只能停用不能删**。删了的话历史合同的类型会变成指向不存在字典项的孤儿值。停用后新建选不到，老合同照常显示。
- **审计日志与业务写入必须同一事务。** `writeAudit()` 只接受事务客户端 `Tx`，用类型焊死了。
- **审计日志只增不改不删。** 应用层没有 UPDATE/DELETE 接口，数据库层还有触发器兜底。因此引用 `audit_logs` 的外键必须是 `Restrict` 而不是 Prisma 默认的 `SetNull`。
- **只有草稿能删。** 其他状态一律只能完结。已完结对所有人只读，ADMIN 也要先解除完结。
- **前端隐藏按钮不算权限**，后端每个接口都会再判一次。
- **状态更新函数必须是纯的。** 别在 `setX(prev => ...)` 里调另一个 setter —— React 严格模式会把更新函数跑两遍，副作用就重复了（涂抹框一次拖拽画出两个，踩过）。
- **拖拽这类跨事件的中间状态同时存一份 ref。** 只从闭包读的话，值取决于 React 有没有在 down 和 up 之间重渲染过，那是个不该依赖的时机。
- **AI 识别结果永远不直接入库**，只预填表单，人核对后走与手工录入完全相同的接口和校验。
- **涂抹是安全边界，改 `extraction/redact.ts` 前先读 `docs/design/04` §2。** 画黑框不等于涂掉 —— 电子版 PDF 走文本层路径，界面画框对送出去的文字毫无影响，必须逐字符剔除。两条路径实现完全不同（文本剔字符／图像涂像素）。`npm run test:redaction` 在载荷层面守着这条。
- **涂抹只作用于送去识别的副本，存档的 PDF 原件完整保留。** 否则归档合同缺了金额就没意义了。
- **multipart 里跟文件同来的字段要用 `req.parts()` 遍历，别用 `file.fields`。** 后者只含文件**之前**的字段，浏览器 FormData 里 redactions 排在 file 后面，用 `file.fields` 读永远是 undefined —— 涂抹会静默失效、内容照样出网。
- **PDF 解析/渲染/切块永远在本地做**（`extraction/document-loader.ts`），刻意不在可替换边界内——换 AI 供应商时这部分不受影响。
- **提示词里的 JSON 示例会被模型当成字段白名单。** 实测：示例里只写 8 个字段时，另外 3 个明明在原文里也不输出（准确率 73%）。字段表和示例**两处都要改**，只改一处会静默漏识别。
- **本地 PDF 解析不是瓶颈。** 实测 20 页抽文本 72ms、扫描件渲染切块 2.5s，而一次模型调用要 10–40 秒。想快只能换模型，拆页并行省不出东西。

## 测试

```bash
npm run smoke -w apps/server           # 接口冒烟 108 项（需先 npm run dev）
npm run test:normalize -w apps/server  # 金额/日期归一化 25 项
npm run test:extraction -w apps/server # 内容识别端到端 40 项（假服务，不出网）
npm run test:redaction -w apps/server  # 涂抹的防泄漏验证 13 项（纯本地）
npm run verify:live -w apps/server     # 真实调用验准确率（会计费）
npm run bench:parse -w apps/server     # 量本地 PDF 解析耗时
```

冒烟测试是**幂等**的，可以在同一个库上反复跑，不需要每次 `db:reset`。写新断言时保持这个性质：不要写死条数或编号，用交叉验证代替。

`test:extraction` 会自己起一个测试服务（:3199）。**Windows 上 `child.kill()` 杀不掉 shell 包装的子进程**，所以脚本在启动前后都按端口清理一遍 —— 不清的话，下一次测试会连上跑着旧代码的僵尸，得出完全误导的结论（踩过一次：涂抹明明修好了，测试一直说没生效）。

## 文档

- `docs/design/00-总体设计.md` —— 候选设计，**未冻结**，与后续模块文档冲突处以模块文档为准
- `docs/design/01-合同主数据模块.md` —— 字段、状态、权限、验收标准
- `docs/design/02-合同内容识别.md` —— DeepSeek 接入、两段式流水线、实测结果
- `docs/design/03-审批流程与设置模块.md` —— 新生命周期、审批、设置模块（供应商字段待财务确认）

**约定：每个模块实现前先出一份模块设计**，放 `docs/design/NN-模块名.md`。

## 下一步

审批流程和数据字典**已完成**。还差：

1. **供应商表** —— 字段清单还在等财务／合同负责人确认，尤其是银行账号要不要进系统。设置页已有占位说明。
2. **用户管理界面** —— 后端 5 个接口都通了，只缺界面。设置页已有占位入口。
3. 支付流程（付款计划、发票、实付跟踪）—— 明确不在本期

已知未做：导出 Excel、全局审计查询页。

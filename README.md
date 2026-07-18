# 智聘通 · 招聘提效 Agent（自动化中枢）

> **定位：提效 Agent，不是互动 Agent。**
> **HR 负责简历收集与上传**；Agent 在后台**自动汇总成统一的腾讯文档格式**、**持续推进招聘流程**、
> **AI 初筛（首轮） + AI 二筛（部门）**、**智能约面 / 复试排期**，并把状态**实时同步**到可视化看板。
> HR 不再手工录入，而是**看板监控 + 判断闸口处置 + 异常介入**。

解决痛点：人工录入效率低、数据易遗漏、二筛/约面靠人工排 —— 用"自动汇总 + AI 辅助判断"替代"手工操作"。

## 核心能力

- **HR 简历收集上传** — HR 完成简历收集与上传（姓名/岗位/来源/联系方式/标签/可面试时间），Agent 接管后续
- **简历拖拽 / 文件夹导入** — 在「腾讯文档」页可直接拖拽 `.txt`/`.md`/`.pdf` 简历，或选择整个文件夹批量导入；自动解析正文、提取姓名与技能标签并一键汇总至腾讯文档（PDF 解析走 CDN 动态加载 pdf.js，无本地依赖）
- **腾讯文档自动聚合** — 所有候选人自动汇总成统一的「招聘简历库（腾讯文档）」格式，实时同步，HR/用人部门可随时查阅
- **流程自动推进** — Agent 自动完成机械阶段：简历收集 → AI 初筛 → 拉群协作 → AI 二筛（含自动汇总腾讯文档）
- **AI 初筛（首轮筛选）** — 对收集到的简历做**基础匹配度评估**并给出**置信度评价**：
  - **≥ 60% 直接过**（自动推进「拉群协作」，进入用人部门二筛）
  - **35%–60% 人工复核**（挂起待 HR 确认）
  - **< 35% 淘汰**
- **AI 二筛（部门二筛）** — 按用人部门需求**生成专业化提示词**，AI 辅助二筛并给出**置信度评价**：
  - **≥ 80% 直接过**（自动推进群面名单）
  - **40%–80% 人工审核**（挂起待 HR 复核）
  - **< 40% 淘汰**
- **约面排期** — 根据**面试官可约时间 × 求职者可面试时间**取交集，**最早且负载低者优先**，合理分配面试时段
- **异常监控** — 候选人长时间卡住或信息缺失自动归集到「异常」面板，类型包括：
  - **推进慢**（某阶段停留过久，建议 HR 介入推进）
  - **识别慢**（简历收集后 Agent 尚未完成识别与汇总）
  - **信息缺失**（缺电话/邮箱/岗位等关键字段，建议 HR 补充）
- **实时同步** — 通过 SSE 把事件、Agent 日志、漏斗统计、异常、二筛记录、排期结果实时推送到看板
- **轻量干预** — HR 用自然语言指令兜底（"把 张伟 推进复试"、"驳回 李娜"），解除挂起并继续流程

## 招聘全流程（11 阶段）

```
简历收集 → AI初筛 → 拉群协作 → AI二筛 → 群面名单 → 群面安排
→ 群面结果 → 结果通知 → 复试名单 → 复试安排 → 复试结果
```

### 判断闸口模型（提效 Agent 的关键设计）

Agent **只自动推进机械阶段**，把需要人判断的环节留给 HR，避免"替 HR 做决定"：

| 阶段 | 谁处理 | 说明 |
|------|--------|------|
| 简历收集 → AI 初筛 → 拉群协作 → AI 二筛 | **Agent 自动** | 收集/汇总/建档/机械推进 |
| AI 初筛（首轮筛选） | **HR 判断闸口** | HR 在「AI 初筛」面板生成提示词、运行初筛、确认置信度与决策 |
| AI 二筛（部门二筛） | **HR 判断闸口** | HR 在「AI 二筛」面板生成提示词、运行二筛、确认置信度与决策 |
| 群面名单（约面排期） | **HR 判断闸口** | HR 在「约面排期」面板发起时间匹配，确认排期 |
| 复试名单（复试约面） | **HR 判断闸口** | 同上，复试场景 |

被「挂起（parked）」的异常候选人，Agent 不会自动推进，直到 HR 在面板中处置（二筛/约面/干预）后解除挂起。

## 架构

```
┌─────────────┐  上传    ┌──────────────────┐   聚合    ┌─────────────┐
│ HR 收集简历  │ ───────▶ │  后端 API          │ ───────▶ │ 腾讯文档(聚合)│
│ (人工完成)   │          │ (Express + SSE)   │          │ 统一简历库   │
└─────────────┘          └────────┬─────────┘          └─────────────┘
                                  │ 写入/推进
                                  ▼
┌─────────────┐   SSE    ┌──────────────────┐          ┌─────────────┐
│  前端看板    │ ◀────── │  自动化引擎        │ ◀──────── │  SQLite     │
│ (5个标签页)  │          │ (automation.ts)   │          │ candidates  │
│ 监控+闸口    │          │ 二筛/约面/异常     │          │ screenings/ │
└─────────────┘          └──────────────────┘          │ interviews   │
                                                        └─────────────┘
```

### 看板标签页

1. **总览看板** — KPI / 招聘漏斗 / 异常面板 / 候选人速览 / 轻量干预
2. **腾讯文档** — 左侧支持**手工录入**、**拖拽 / 文件夹批量导入**（自动解析 PDF / 文本并提取技能标签）；右侧腾讯文档式简历库（自动同步）
3. **AI 初筛** — 待初筛候选人列表 + 初筛工作台（岗位通用要求 / 生成提示词 / 运行初筛 / 结果）+ 初筛记录
4. **AI 二筛** — 待二筛候选人列表 + 二筛工作台（部门需求 / 生成提示词 / 运行二筛 / 结果）+ 二筛记录
5. **约面排期** — 面试官可约时间编辑 + 待约面 / 待复试候选人 + 面试 / 复试排期表
6. **实时监控** — 实时事件流 + Agent 行为日志

## 技术栈

- **前端**: React 18 + TypeScript + Vite + TDesign React + Tailwind CSS
- **后端**: Node.js + Express + TypeScript + SSE（Server-Sent Events）
- **数据库**: SQLite (better-sqlite3, WAL 模式)
- **SDK 接入点**: CodeBuddy Agent SDK (`@tencent-ai/agent-sdk`) 用于 LLM 解析与二筛（可选启用）

## 快速开始

```bash
npm install
npm run dev               # 前端 5173 + 后端 3000，自动启动提效 Agent
```

打开 http://localhost:5173 即可看到自动化控制中枢实时运行。

### 构建纯前端演示 Demo（公网部署，无需后端）

演示 Demo 用一个**自包含的前端引擎**（`src/demo/engine.ts`，逻辑与后端 `server/automation.ts` 对齐）替代后端，
通过构建期注入 `VITE_DEMO=true` 切换，生成的 `dist/` 可直接静态托管：

```bash
npm install
VITE_DEMO=true npx vite build      # 产出自包含 dist/（含种子数据与演示引擎）
# 静态托管 dist/ 即可，例如：npx vite preview --port 4173
```

> `npm run build` 现已可用：构建脚本改为 `tsc -p tsconfig.json && vite build`，
> 仅对招聘应用代码做类型检查（模板自带的 Chat 组件已从 `tsconfig.json` 的 `exclude` 中剔除，不计入构建）。
> 演示构建只需 `VITE_DEMO=true npm run build`。另有 `npm run verify:demo` 用真实浏览器一键验证 6 个标签页不白屏。

## API 端点

### 自动化中枢

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/stream` | GET | SSE 实时流（快照 + 增量事件/日志/统计/异常/二筛/排期） |
| `/api/automation/status` | GET | 引擎运行状态 |
| `/api/automation/control` | POST | 控制：`{action:'start'|'stop'|'reset'}` |
| `/api/agent-logs` | GET | 自动化行为日志 |
| `/api/events` | GET | 采集层原始事件 |
| `/api/anomalies` | GET | 异常面板（`/api/alerts` 为兼容别名） |
| `/api/intervention` | POST | 轻量干预：`{command:'把 张伟 推进复试'}` |

### 腾讯文档聚合

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/hr/upload-resume` | POST | HR 上传简历：`{name,position,source,phone,email,tags,availability}` |
| `/api/tencent-doc` | GET | 获取腾讯文档式简历库快照（自动聚合） |

### AI 初筛（首轮筛选）

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/ai-initial-screening-prompt` | POST | 预览初筛提示词：`{candidateId, requirement?}` |
| `/api/ai-initial-screening` | POST | 运行 AI 初筛（置信度分级）：`{candidateId, requirement?}` |

### AI 二筛（部门二筛）

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/ai-screening-prompt` | POST | 预览二筛提示词：`{candidateId, deptRequirement?}` |
| `/api/ai-screening` | POST | 运行 AI 二筛（置信度分级）：`{candidateId, deptRequirement?}` |
| `/api/screening-records` | GET | 初筛 + 二筛记录（含 `phase: initial|secondary`、置信度与决策） |

### 约面排期

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/interviewers` | GET/POST | 面试官与可约时间 |
| `/api/schedule-interview` | POST | 执行约面排期（时间取交集）：`{candidateId, type:'group'|'retest', interviewerId?}` |
| `/api/schedule` | GET | 面试排期表 |

### 招聘业务（数据层）

| 端点 | 方法 | 描述 |
|------|------|------|
| `/api/candidates` | GET/POST | 候选人列表/创建 |
| `/api/candidates/:id` | GET/PATCH/DELETE | 候选人 CRUD |
| `/api/interviews` | GET/POST | 面试记录 |
| `/api/pipeline-stats` | GET | 招聘漏斗统计 |
| `/api/stage-labels` | GET | 阶段标签 |

## 演示说明

- 启动后引擎自动运行，首屏含种子数据（含 3 个被「挂起」的异常候选人用于演示异常面板）
- **HR 简历上传**：在「腾讯文档」页填写并上传，Agent 自动汇总到腾讯文档式简历库并继续推进
- **AI 初筛**：在「AI 初筛」页选择待初筛候选人 → 输入岗位通用要求 → 生成专业提示词 → 运行初筛 → 查看置信度与「直接过 / 人工复核 / 淘汰」决策
- **AI 二筛**：在「AI 二筛」页选择待二筛候选人 → 输入用人部门需求 → 生成专业提示词 → 运行二筛 → 查看置信度与「直接过 / 人工审核 / 淘汰」决策
- **约面 / 复试排期**：在「约面排期」页编辑面试官可约时间 → 对待约面候选人发起群面排期、对待复试候选人发起复试排期 → Agent 取时间交集、分配最早时段
- **异常处置**：在「总览」/「异常」面板查看推进慢/识别慢/信息缺失，HR 介入处置后异常自动消解
- 顶部可**暂停/启动/重置**引擎

## 置信度与约面算法说明

- **置信度（规则引擎 / 真实 LLM 双轨）**：默认用确定性规则计算 0–100 评分；当后端配置了 `CODEBUDDY_API_KEY` 时，
  自动切换为 **CodeBuddy SDK 真实 LLM 解析**（`server/automation.ts` 的 `callLLM` / `parseVerdict`，解析失败或超时自动回退规则引擎），实现真正的 AI 初筛 / 二筛。
- **约面排期**：取求职者可面试时间与面试官可约时间的**交集**，按时间升序取最早可用时段；优先选择同部门面试官。
- 演示零成本可运行（规则解析，无需 API Key）。

## 环境要求

- Node.js 18+
- 演示零成本可运行（规则解析，无需 API Key）

## 公网演示 Demo

- **在线 Demo（GitHub Pages 永久托管，推荐）**：https://moshenluo.github.io/recruit-agent-web/
- **源码仓库（GitHub）**：https://github.com/Moshenluo/recruit-agent-web

> 说明：早期曾用 CloudStudio 临时沙箱托管（链接 `e292f12c4bdd42b09d02257da64309e9.app.codebuddy.work`），
> 但该沙箱会被回收/冷启，导致 `ERR_EMPTY_RESPONSE` 类「打不开」。现已改用 **GitHub Pages** 永久静态托管，
> 跟随仓库 `gh-pages` 分支自动发布，稳定不掉线。

Demo 为纯前端自包含版本，含完整种子数据：覆盖全部 11 个阶段、AI 初筛 / AI 二筛记录（按 `phase` 区分）、
异常面板与约面 / 复试排期，首屏即自动运行，可直接在页面上体验「初筛 → 二筛 → 约面 → 复试」全流程。

### 重新发布 Demo 到 GitHub Pages

```bash
# 1) 构建纯前端演示（无需后端）
VITE_DEMO=true npx vite build          # 产物输出到 dist/，资源使用相对路径 ./assets

# 2) 发布到 gh-pages 分支（首次需安装 gh-pages）
npx gh-pages -d dist -b gh-pages -t -m "deploy: 智聘通 demo"
# 仓库 Pages 已配置为 gh-pages 分支根目录，推送后自动上线
```

### 自动部署（GitHub Actions）

仓库已内置 `.github/workflows/deploy.yml`：向 `main` 分支 `push` 时自动执行
`VITE_DEMO=true npm run build` 并发布到 `gh-pages` 分支，GitHub Pages 随即更新公网 Demo，无需手动操作。

也可手动触发：仓库 `Actions → Deploy Demo to GitHub Pages → Run workflow`。



## License

MIT

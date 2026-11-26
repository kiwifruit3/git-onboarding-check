# AI_USAGE.md · AI 使用说明与验证记录

本文件说明本项目在开发过程中使用了哪些 AI 工具、如何组织提示词、如何验证 AI 的输出，以及**AI 给出错误结论但被验证流程发现**的真实案例。

> 说明：以下记录均来自本次真实开发过程，命令输出与报错为原文摘录；提示词为当时使用的原文（个别为节省篇幅做了截断，已标注）。

---

## 1. 使用了哪些 AI 工具

| 工具 | 模型 | 用途 | 占比 |
| --- | --- | --- | --- |
| **DeepSeek Harness（DSH）** 桌面端 | `deepseek-v4.1-flash` | 主 Coding Agent：需求拆解、架构设计、全部代码生成、文档撰写 | ~95% |
| DSH 内置浏览器验证工具 | – | 页面渲染验证、控制台报错检查、截图 | 辅助 |
| 未使用 | – | 未使用 Copilot / Cursor / ChatGPT 等，全程单一 Agent 会话 | – |

**协作方式**：人给出目标与约束（题目、技术栈偏好、验收标准），AI 负责拆解、实现、自测与修复；人负责关键决策（是否接入 AI、是否公网部署、仓库归属）与最终验收。

> **关于工具内的「AI 接入建议」**：本次交付**未配置任何 LLM API Key**，因此页面上的 AI 建议由内置规则引擎
> （`heuristic-v1`）按模板从扫描结果拼装，**不是大模型输出**——界面徽章、报告 JSON 的 `ai.source` 都标注了
> `local-rules`，AI 页签还有一块「未启用大模型」的说明。工具已预留 DeepSeek / 通义 / 任意 OpenAI 兼容端点
> （含本地 Ollama）通道，配置 Key 后自动切换，调用失败会回退。之所以不伪装成 AI：AI 输出的可信度依赖
> 可验证性，把规则输出标成 AI 会让评审无法判断真实性。

## 2. 关键提示词记录

### 2.1 需求拆解

```text
题目：Git 仓库接入体检工具。用户输入公开 Git 仓库链接，自动分析 README、依赖清单、
启动脚本完整度；Windows 专用脚本（.bat/.cmd/.ps1/.vbs）；硬编码路径（C:\、/Users/、绝对路径）；
密钥与敏感信息（sk-、AKID、Bearer、私钥、.env 入库）。可视化展示，给出接入就绪度评分和
主要风险清单。加分项：AI 给出项目评分或接入建议。
要求：核心功能跑通；不限技术栈；提交 GitHub 仓库地址；附 AI_USAGE.md，含至少 1 条
「AI 答错但被你发现」的记录；README 中说明更新跟踪设计（怎么发现更新、怎么避免全量重算、
报告如何标注 commit、失败或限流时怎么兜底）。
```

### 2.2 架构与反脆弱设计

```text
不要依赖 GitHub REST API：匿名 60 次/小时很容易被限流。用 git ls-remote 拿 HEAD，
再用 codeload 的 tar.gz 按 commit 下载源码；失败回退 shallow clone。
所有产物按 commit SHA 缓存，天然支持「同一 commit 不重算」。
```

### 2.3 评分模型

```text
设计 6 个维度的接入就绪度评分，权重合计 100，按「接入方视角的阻塞程度」排序：
密钥安全与跨平台兼容最容易导致拿到就出事，权重最高；文档/依赖/启动脚本决定能不能跑起来；
工程规范属于锦上添花。给出 A-E 等级与一句话结论。
```

### 2.4 误报治理（迭代了 4 轮）

```text
密钥扫描必须做误报治理，否则报告没有可信度：
1) 占位符过滤（your-key / xxx / abc123 / <token> / process.env / ${...}）；
2) 尊重 gitleaks:allow、nosec 等显式豁免注释；
3) 私钥必须带 base64 主体，不能只匹配 -----BEGIN PRIVATE KEY----- 文件头；
4) 测试目录 / _test.go / testdata 的命中降为低置信，不计入评分；
5) 同一文件同一规则命中 ≥5 次判为样例数据（扫描器规则库）。
```

### 2.5 视觉与交互

```text
浅色、克制、信息密度优先，接近「体检报告」的阅读体验：评分环形仪表盘 + 六维条 +
严重度分布 + 可展开的风险清单（证据/建议/置信度）+ 页签下钻。不要用图表库，手写 SVG。
```

## 3. 如何验证 AI 的输出

AI 生成的代码不能「看起来对」就交付，本项目建立了 5 层验证：

| 层级 | 手段 | 发现过的问题 |
| --- | --- | --- |
| 语法/类型 | `node --check`、`tsc --noEmit` | 编码损坏导致的 `SyntaxError` |
| 单元/回归 | `node scripts/smoke.mjs <repo>` 跑真实仓库 | 误报、漏报、评分异常 |
| 接口 | `POST /api/analyze` 断言 score / commit / 耗时 | 限流、代理、缓存未生效 |
| 端到端 | 浏览器打开页面 → 点击 → 读控制台 → 截图比对 | 渲染错位、证据块遮挡、按钮无效 |
| 交叉验证 | 同一事实用两种方式核对（如 `git ls-remote` 输出 vs 报告里的 commit） | 结论与真实 SHA 不一致 |

**验收标准**（每条都实际执行过）：

- `npm run build` 成功、`tsc --noEmit` 零错误；
- 页面控制台零报错、零失败请求；
- 至少 5 个真实公开仓库跑通，分数与人工判断一致；
- 中文文件名 / emoji 文件名 / 空仓库 / 私有仓库 / 超大仓库都有明确行为。

## 4. AI 答错但被发现（真实记录）

### 案例 1：AI 假设系统 `tar` 能可靠解压，结果中文文件名直接失败

**AI 的做法**：用 `tar -xzf` + `--strip-components=1` 解压 GitHub 源码包。

**怎么发现的**：跑 `expressjs/express` 时报告显示 `来源 clone`（本应优先用体积更小的 archive），
但没有任何报错提示——因为 archive 失败后被 clone 兜底「悄悄吞掉」了。于是单独跑了一次解压：

```text
tar : examples/downloads/files/CCTV大赛上海分赛区.txt: Invalid empty pathname: Unknown error
tar : test/fixtures/snow ☃/: Invalid empty pathname: Unknown error
tar.exe: Error exit delayed from previous errors.
```

285 个条目只解出 14 个，且退出码为 1。根因是 Windows 自带 bsdtar 对非 ASCII 文件名的路径转换有缺陷。

**修复**：改用纯 JS 的 `tar` 库解压，并在解压前遍历条目校验绝对路径 / `..` 穿越 / 符号链接。
**验证**：express 来源从 `clone` 变为 `archive`，文件数仍为 217（clone 兜底保证了完整性，所以问题
没有表现为「数据缺失」，而是多花了约 9 秒且失败被静默吞掉）；耗时从 17.6s 降到 8.5s。

### 案例 2：UNC 路径正则把 JS 转义序列误判成网络共享路径

**AI 的做法**：UNC 规则写成 `/\\\\[A-Za-z0-9._-]+\\[^\s...]*/g`。

**怎么发现的**：express 报告里出现 4 条「高危 · 硬编码路径」，展开证据一看：

```text
test/res.json.js:124   windows-unc   \\u003cscript\\u003e
test/res.location.js:242   windows-unc   \\bar\\baz
```

`\\u003c` 是 JS 字符串里的 Unicode 转义，`\\bar\\baz` 是测试用的路径字符串，都不是真实 UNC 路径。

**修复**：过滤 `\\u/\\x` 开头的转义序列与 `\\n/\\r/\\t` 等控制字符转义；测试目录命中降为低危 + 低置信。
**验证**：express 的硬编码路径风险从 4 条高危降为 2 条低危（且只在测试目录），误报清零。

### 案例 3：AI 认为「用 GitHub API 拿默认分支和 commit」是标准做法

**AI 的初版设计**：`GET /repos/{owner}/{repo}` → `GET /repos/{owner}/{repo}/commits/{branch}`。

**怎么发现的**：联调时接口直接失败，返回原文：

```json
{"message":"API rate limit exceeded for 3.115.204.39. (But here's the good news:
Authenticated requests get a higher rate limit...)"}
```

匿名 API 每小时 60 次，开发期间反复调试几分钟就打满了——这意味着真实用户也会频繁失败。

**修复**：改为 `git ls-remote --symref`（一次请求拿到分支 + HEAD SHA，不受 API 限流），
源码用 codeload archive 按 commit 下载，API 仅在配置 `GITHUB_TOKEN` 时作为兜底。
**验证**：删除 `GITHUB_TOKEN` 后连续分析 5 个仓库全部成功，且耗时更短。

### 案例 4：AI 用 PowerShell 批量改文件，把 UTF-8 中文写坏

**AI 的做法**：为了批量替换一行，用了 `(Get-Content -Raw) -replace ... | Set-Content -NoNewline`。

**怎么发现的**：紧接着的 `node --check` 直接报错：

```text
D:\...\server\lib\rules\paths.mjs:41
    label: '系统级绝对路�?,
           ^^^^^^^^^^
SyntaxError: Invalid or unexpected token
```

`Set-Content` 默认编码把中文注释写成了乱码，且损坏是静默的（文件仍能读，只是内容变了）。

**修复**：重写受影响的两个文件（`paths.mjs`、`analyze.mjs`），改用能保证 UTF-8 的写入方式；
并加了一步全仓库 mojibake 扫描（`Select-String -Pattern '�'`）作为回归检查。
**验证**：6 个服务端模块 `node --check` 全绿，mojibake 扫描结果 `clean`。

### 案例 5：AI 把「库」当成「应用」打分，误判 express 缺少启动入口

**AI 的做法**：只要 `package.json` 没有 `start/dev` 脚本就报「未找到明确的启动入口」高危。

**怎么发现的**：express 得分 78、被扣 15 分在「启动脚本」，但 express 是 Web 框架库，
本来就不需要 `npm start`；这个结论会误导接入方。人工复核评分明细时发现。

**修复**：增加「库项目」判定（有 `main/exports/module/types/files` 或根目录 `index.js`，
且无 `start/dev/serve` 脚本、无 `bin`）——库项目缺失锁文件降为低危、没有 start 不扣分。
**验证**：express 从 78 分 B 升到 86 分 A，风险项从 5 条降到 4 条，且剩余问题（README 缺运行说明）
是真实可整改项。

> 另有一次「AI 把本机失效代理当成网络问题」的排查：git 全局配置了 `127.0.0.1:12000`（已失效），
> 而系统代理 `127.0.0.1:7897` 才是可用的。AI 起初只做了「直连失败就直连重试」，
> 被 `git ls-remote` 的 21 秒超时暴露后，改为按「环境变量 → git config → 系统代理 → 直连」
> 探测可用代理（TCP 探测 350ms），并给 git / 下载分别做了代理与直连的双路回退。

## 5. AI 输出的人工审查点

即使 AI 生成的代码能跑，以下几处仍做了人工判断，**没有盲信**：

- **评分权重**：AI 给的是「密钥 25 / 跨平台 25 / 文档 15 / 依赖 15 / 脚本 15 / 规范 5」，
  人工确认「安全 + 可移植性占一半」符合接入场景的真实痛点，保留；
- **风险等级**：AI 最初把所有硬编码路径都定为高危，人工要求按文件类型（代码/配置/文档/测试）分级，
  否则报告会「全是高危」而失去优先级；
- **AI 建议的措辞**：内置规则引擎生成的建议里出现过「建议整改」这类空话，人工要求改成
  可执行动作（改哪个文件、换成什么写法）；
- **README 的更新跟踪章节**：明确区分「已实现」与「设计但未实现」，不允许把设计写成已实现。

## 6. 局限与反思

- AI 在**跨平台细节**（Windows tar、编码、代理）上容易想当然，必须用真实环境跑一遍；
- AI 生成的**正则**是误报重灾区，每一条规则都要拿真实仓库的命中证据反查；
- AI 很擅长把「能跑」写得像「正确」，因此本项目把「证据展示」做进 UI——**让人能自己判断**，
  而不是只给一个分数；
- 本项目所有 AI 生成内容都经过上述验证流程，但仍不排除遗漏，欢迎在 Issue 中指正。

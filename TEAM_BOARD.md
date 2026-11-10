# Feedback Hub 项目协作看板 (TEAM_BOARD.md)

## 1. 业务目标与价值主张
- **项目名称**：`feedback-hub`
- **核心定位**：专为独立开发者多产品矩阵量身打造的零维护、去客服化、双端自适应、**Google Sheets 在线表格呈现**的集中式工单反馈中心。
- **价值主张**：
  1. **零服务器成本**：基于 Cloudflare Workers 免费额度（每日 10 万次请求），单 Worker 统一承载前端 Webview H5、在线表格与后端 API；
  2. **双端自适应响应式（移动端 + 桌面端）**：移动端单列流式触控，桌面端双栏精美 Split View，支持 `⌘/Ctrl + Enter` 快捷提交；
  3. **Google Sheets 在线表格呈现**：与 Google 生态天然契合，自动向专属 Google 电子表格追加新行，随时随地在手机或电脑以表格管理反馈；
  4. **AI 智能分拣与结构化**：Gemini 自动提炼 15 字核心标题、全球多语言中文翻译、严重程度分级并拦截垃圾信息。

---

## 2. WBS 任务编排与状态矩阵 (DAG)

| 任务 ID | 任务模块 | 负责人 | 前置依赖 | 交付物路径 | 状态 | 验收核验标准 |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- |
| **TASK-01** | 项目工程骨架与 Wrangler 配置 | Developer | 无 | `wrangler.toml`, `package.json` | **DONE** | 配置文件语法合法，变量与 secrets 声明完备 |
| **TASK-02** | 移动端+桌面端双端自适应 UI | Developer | TASK-01 | `src/index.js` | **DONE** | 支持移动端竖屏卡片 + 桌面端双栏布局与快捷键 |
| **TASK-03** | Google Sheets 自动化接入与 ego-browser 全自动联调 | Developer | TASK-02 | `docs/GOOGLE_SHEETS_SETUP.md`, `src/index.js`, `.dev.vars` | **DONE** | ego-browser 全自动创建 Apps Script 并部署为任何人可访问的 Web App，实测写入成功 |
| **TASK-04** | 跨平台客户端 SDK 代码片段封装 | Developer | TASK-02 | `clients/` (Kotlin, Swift, Dart, JS) | **DONE** | 四大平台开箱即用，自动拼接 URL Query 与 extra JSON |
| **TASK-05** | 本地集成验证与健壮性测试 | QA | TASK-02 | `test/mock_test.js` | **DONE** | 覆盖正常流程、蜜罐拦截、AI 超时降级等 8/8 用例全部通过 |
| **TASK-06** | 生产环境正式部署、终端隐私彻底隔离与全球多语言 (i18n) 支持 | Manager | TASK-01~05 | Cloudflare Workers (`feedback-hub`) | **DONE** | 线上域名 `https://feedback-hub.robin421.workers.dev` 部署完成，支持全球 8 种主流语言自适应与即时切换，Gemini 自动跨语言翻译归集 |

---

## 3. 在线入口直达

### 👥 终端用户面向（面向普通客户 / App 用户 / 网站访客）
- **正式生产环境反馈表单**：
  `https://feedback-hub.robin421.workers.dev/?pkg=aisubdeal&lang=zh`
- **支持的产品标识 Query (pkg)**：
  - `aisubdeal` -> 对应 GitHub 仓库 `robin421/aisubdeal`
  - `fitflow` -> 对应 GitHub 仓库 `robin421/FitFlow`
  - `bank-parser` -> 对应 GitHub 仓库 `robin421/bank-statement-parser`
  - `firstbend` -> 对应 GitHub 仓库 `robin421/FirstBend`
  - `conduit` -> 对应 GitHub 仓库 `robin421/conduit-bend-calc`
  - 其它新产品 -> 自动落入 `robin421/feedback-inbox` 兜底仓库
- **隐私保障**：普通用户提交后仅展示当前工单凭据（流水号、分类、详细内容、邮箱、状态），绝无任何后台表格或其它用户数据泄漏！

### 🛡️ 管理员专属后台（仅供您本人查看）
- **您的 Google Sheets 专属工单汇总表**：
  [https://docs.google.com/spreadsheets/d/1fTsinvOlJmJmRFKntivtfv3B-63kk2A4Y1MycmkM6oQ/edit](https://docs.google.com/spreadsheets/d/1fTsinvOlJmJmRFKntivtfv3B-63kk2A4Y1MycmkM6oQ/edit)
- **线上轻量多维筛选看板**：
  `https://feedback-hub.robin421.workers.dev/admin` (或 `/sheet`)

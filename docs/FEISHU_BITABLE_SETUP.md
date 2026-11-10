# 飞书多维表格（Feishu Bitable）自动化同步指南

飞书多维表格（Bitable）拥有极佳的国内访问速度，并支持**看板视图、画册视图与微信/飞书手机端实时推送通知**。通过飞书官方内置的**“自动化流程 (Webhook)”**，无需申请开发者资质或对接复杂的 OpenAPI，即可实现工单自动入库。

---

## 一键配置步骤 (仅需 2 分钟)

### 步骤 1：新建飞书多维表格
1. 打开飞书客户端或访问 [https://www.feishu.cn](https://www.feishu.cn)；
2. 新建一个**空白多维表格**，命名为 `FeedbackHub 工单看板`；
3. 为表格添加以下字段（字段类型建议）：
   - `时间` (日期时间 或 单行文本)
   - `产品` (单选 或 单行文本)
   - `分类` (单选)
   - `严重程度` (单选: HIGH / MEDIUM / LOW)
   - `AI核心摘要` (单行文本)
   - `用户反馈` (多行文本)
   - `中文翻译` (多行文本)
   - `联系邮箱` (单行文本)
   - `版本号` (单行文本)
   - `运行系统` (单行文本)
   - `扩展参数` (多行文本)
   - `处理状态` (单选: 待处理 / 已评估 / 已修复)

---

### 步骤 2：创建 Webhook 自动化流程
1. 点击多维表格右上角的 **自动化（Automation）** 图标 -> **新建自动化流程**；
2. **触发器 (Trigger)**：
   - 选择 **当接收到 Webhook 时 (When Webhook is received)**；
   - 飞书会自动生成一个专属的 Webhook 触发地址（形如 `https://open.feishu.cn/open-apis/bot/v2/hook/xxxx` 或流程 Webhook）；
3. **执行操作 (Action)**：
   - 点击添加操作 -> 选择 **添加记录 (Add record)**；
   - 选择当前数据表；
   - 将各个字段与 Webhook 传入的 JSON 键名映射：
     - `时间` 引用 `{{webhook.time}}`
     - `产品` 引用 `{{webhook.pkg}}`
     - `分类` 引用 `{{webhook.category}}`
     - `严重程度` 引用 `{{webhook.severity}}`
     - `AI核心摘要` 引用 `{{webhook.summary}}`
     - `用户反馈` 引用 `{{webhook.content}}`
     - `中文翻译` 引用 `{{webhook.translation}}`
     - `联系邮箱` 引用 `{{webhook.email}}`
     - `处理状态` 设为固定值 `待处理`
4. （可选）再添加一个操作：**发送飞书通知消息**，一旦收到 `HIGH` 级别工单自动在飞书群里 @提醒自己；
5. 点击右上角 **保存并启用**。

---

### 步骤 3：填入 Feedback Hub 配置
复制飞书自动化给出的 Webhook 地址，写入 [`.dev.vars`](../.dev.vars) 和 [`wrangler.toml`](../wrangler.toml)：
```toml
FEISHU_WEBHOOK_URL = "https://open.feishu.cn/open-apis/bot/v2/hook/xxxx"
```

如果部署到 Cloudflare 生产环境，执行：
```bash
npx wrangler secret put FEISHU_WEBHOOK_URL
# 粘贴您的飞书 Webhook 地址
```

大功告成！任何端提交工单后，飞书多维表格会自动收到并创建新记录！

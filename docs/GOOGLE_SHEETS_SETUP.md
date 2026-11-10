# Google Sheets 在线表格自动化同步指南 (推荐)

使用 **Google Sheets + Google Apps Script Web App**，无需复杂的 Google Cloud Console 授权与 OAuth 刷新 Token，仅需 **1 分钟** 即可拥有一个永远免费、实时追加新行的在线工单表格。

---

## 一键配置步骤 (仅需 60 秒)

### 步骤 1：新建一个 Google 电子表格
1. 打开浏览器访问：[https://sheets.new](https://sheets.new)（或在 Google Drive 中新建一个空白表格）；
2. 将表格命名为：`FeedbackHub 产品矩阵工单汇总表`。

---

### 步骤 2：打开 Apps Script 粘贴自动化脚本
1. 在表格顶部菜单栏，点击 **Extensions（扩展程序）** -> **Apps Script**；
2. 清空代码编辑框中的默认内容，完整粘贴以下轻量脚本：

```javascript
/**
 * Feedback Hub - Google Sheets 自动化接收脚本
 * 自动识别表头，每次提交自动追加新行并设置排版样式
 */
function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);

    // 1. 如果表格为空，自动初始化漂亮的表头
    if (sheet.getLastRow() === 0) {
      var headers = [
        "提交时间",
        "产品标识 (pkg)",
        "分类",
        "严重级别",
        "AI 核心摘要",
        "用户原始反馈",
        "中文翻译",
        "联系邮箱",
        "应用版本",
        "运行系统",
        "扩展参数 (extra)",
        "处理状态"
      ];
      sheet.appendRow(headers);
      
      // 美化表头样式（深色背景、加粗、冻结首行）
      var headerRange = sheet.getRange(1, 1, 1, headers.length);
      headerRange.setBackground("#1e293b")
                 .setFontColor("#ffffff")
                 .setFontWeight("bold");
      sheet.setFrozenRows(1);
    }

    // 2. 追加工单新行
    sheet.appendRow([
      data.time || new Date().toISOString(),
      data.pkg || "default",
      data.category || "未分类",
      data.severity || "LOW",
      data.summary || "",
      data.content || "",
      data.translation || "",
      data.email || "未提供",
      data.ver || "1.0.0",
      data.os || "Unknown",
      typeof data.extra === "string" ? data.extra : JSON.stringify(data.extra || {}),
      data.status || "待处理"
    ]);

    return ContentService.createTextOutput(JSON.stringify({ status: "success" }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService.createTextOutput(JSON.stringify({ status: "error", message: err.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}
```

3. 点击顶部工具栏的 **保存图标（💾 存储项目）**。

---

### 步骤 3：部署为 Web App (获取 Webhook URL)
1. 点击右上角蓝色的 **Deploy（部署）** -> **New deployment（新建部署）**；
2. 在弹窗左侧点击齿轮图标，选择 **Web app**；
3. 参数填写：
   - **Description**: `Feedback Hub Sync`
   - **Execute as（以何人身份执行）**: 保持默认 `Me (你的账号)`
   - **Who has access（谁有权访问）**: **务必选择 `Anyone（任何人）`**
4. 点击 **Deploy（部署）**；
   - 若弹出授权提示，点击 *Authorize access（授权访问）* -> 选择你的 Google 账号 -> 点击左下角 *Advanced（高级）* -> 点击 *Go to Untitled project (unsafe)* -> 点击 *Allow（允许）*；
5. 复制生成的 **Web app URL**（形如 `https://script.google.com/macros/s/AKfycb.../exec`）。

---

### 步骤 4：填入 Feedback Hub 配置
将复制到的 URL 写入 [`.dev.vars`](../.dev.vars) 和 [`wrangler.toml`](../wrangler.toml)：
```toml
GOOGLE_SHEET_WEBHOOK_URL = "https://script.google.com/macros/s/AKfycb.../exec"
```

如果部署到 Cloudflare 生产环境，执行：
```bash
npx wrangler secret put GOOGLE_SHEET_WEBHOOK_URL
# 粘贴您的 Web app URL
```

大功告成！之后任何产品提交的工单，都会实时、自动追加到您的 Google 电子表格中！

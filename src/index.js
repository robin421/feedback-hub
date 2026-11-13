/**
 * Feedback Hub - Cloudflare Worker
 * 零维护、单向收集（免当客服）的集中式工单反馈中心
 * 
 * 核心功能：
 * 1. GET  /            -> 托管移动端 + 桌面端双端自适应 H5 表单（Tailwind CSS CDN + 深色模式 + 动态配置 + 快捷键）
 * 2. GET  /sheet       -> 托管内置“在线多维工单表格看板”，支持搜索、筛选、详情抽屉与 CSV 导出
 * 3. POST /api/submit  -> 接收工单，Gemini 智能结构化/翻译/反垃圾，自动同步腾讯文档在线表格与 GitHub Issues
 * 4. GET  /api/tickets -> 获取工单数据列表接口 (JSON)
 */

// 内存暂存工单列表（用于内置 /sheet 网页表格展示，同时持久化推送到腾讯在线文档与 GitHub）
let IN_MEMORY_TICKETS = [
  {
    id: "init-01",
    time: "2026-11-10 23:06",
    pkg: "aisubdeal",
    category: "功能建议",
    severity: "LOW",
    summary: "详情页增加汇率换算工具",
    content: "建议在订阅比价详情页增加一个汇率换算的小工具，方便查看不同货币结算的实际价格差。",
    translation: "建议在订阅比价详情页增加一个汇率换算的小工具，方便查看不同货币结算的实际价格差。",
    email: "test-user@example.com",
    ver: "1.0.4",
    os: "macOS 15.0 - Chrome Extension",
    extra: '{"feature":"currency-converter","plan":"pro"}',
    status: "待处理"
  }
];

// 默认在线表格配置 (首选 Google Sheets)
const DEFAULT_SHEET_CONFIG = {
  viewUrl: "https://docs.google.com/spreadsheets/d/1fTsinvOlJmJmRFKntivtfv3B-63kk2A4Y1MycmkM6oQ/edit"
};

// 腾讯文档在线表格兼容配置
const DEFAULT_TENCENT_CONFIG = {
  url: "https://docs.qq.com/openapi/mcp",
  token: "b0529a2f2599474aa265d522781c9c2b",
  fileId: "ZwdtMfMVMIKi",
  sheetId: "BB08J2",
  viewUrl: "https://docs.qq.com/sheet/DWndkdE1mTVZNSUtp"
};

// 默认仓库映射表
const DEFAULT_REPO_MAP = {
  "com.turboLink.fast": "your-org/nnlink-repo",
  "ext.lockbox": "your-org/lockbox-repo",
  "aisubdeal": "robin421/aisubdeal",
  "fitflow": "robin421/FitFlow",
  "bank-parser": "robin421/bank-statement-parser",
  "firstbend": "robin421/FirstBend",
  "conduit": "robin421/conduit-bend-calc",
  "default": "robin421/feedback-inbox"
};

/**
 * Cloudflare Worker ESM 入口
 */
export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);

    // 1. 处理 CORS 预检请求
    if (request.method === "OPTIONS") {
      return handleCORS();
    }

    // 2. 路由分发
    if ((request.method === "GET" || request.method === "HEAD") && url.pathname === "/") {
      return handleGetHome(url, env);
    }

    if ((request.method === "GET" || request.method === "HEAD") && (url.pathname === "/sheet" || url.pathname === "/admin")) {
      return handleGetSheet(url, env);
    }

    if (request.method === "GET" && url.pathname === "/api/tickets") {
      return new Response(JSON.stringify({ success: true, data: IN_MEMORY_TICKETS }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }

    if (request.method === "POST" && url.pathname === "/api/submit") {
      return handleFeedbackSubmit(request, env);
    }

    // 404 兜底
    return new Response(JSON.stringify({ error: "Not Found" }), {
      status: 404,
      headers: { "Content-Type": "application/json", ...corsHeaders() }
    });
  }
};

/**
 * CORS 响应头配置
 */
function corsHeaders() {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, HEAD, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, X-Requested-With, Accept"
  };
}

function handleCORS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders()
  });
}

/**
 * GET / 处理：渲染移动端 + 桌面端自适应 H5 表单页面
 */
function handleGetHome(url, env) {
  const pkg = url.searchParams.get("pkg") || "default";
  const ver = url.searchParams.get("ver") || "1.0.0";
  const os = url.searchParams.get("os") || "";
  const lang = (url.searchParams.get("lang") || "en").toLowerCase();
  const extra = url.searchParams.get("extra") || "";
  const title = url.searchParams.get("title") || "";
  const desc = url.searchParams.get("desc") || "";
  const categories = url.searchParams.get("categories") || "";
  const placeholder = url.searchParams.get("placeholder") || "";
  const sheetViewUrl = (env && (env.GOOGLE_SHEET_VIEW_URL || env.TENCENT_DOCS_VIEW_URL)) || DEFAULT_SHEET_CONFIG.viewUrl;

  const html = renderHTML({
    pkg,
    ver,
    os,
    lang,
    extra,
    sheetViewUrl,
    customTitle: title,
    customDesc: desc,
    customCategories: categories,
    customPlaceholder: placeholder
  });

  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "public, max-age=60",
      ...corsHeaders()
    }
  });
}

/**
 * GET /sheet 处理：渲染内置的现代在线多维工单表格视图
 */
function handleGetSheet(url, env) {
  const sheetViewUrl = (env && (env.GOOGLE_SHEET_VIEW_URL || env.TENCENT_DOCS_VIEW_URL)) || DEFAULT_SHEET_CONFIG.viewUrl;
  const html = renderSheetHTML({ sheetViewUrl });
  return new Response(html, {
    status: 200,
    headers: {
      "Content-Type": "text/html; charset=utf-8",
      "Cache-Control": "no-cache",
      ...corsHeaders()
    }
  });
}

/**
 * POST /api/submit 处理：接收工单提交
 */
async function handleFeedbackSubmit(request, env) {
  try {
    let payload;
    try {
      payload = await request.json();
    } catch (e) {
      return new Response(JSON.stringify({ success: false, error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }

    const {
      category = "",
      content = "",
      email = "",
      pkg = "default",
      ver = "1.0.0",
      os = "Unknown",
      lang = "en",
      extra = null,
      website_url = "" // Honeypot 蜜罐字段
    } = payload;

    // 1. Honeypot 蜜罐防刷检测
    if (website_url && website_url.trim().length > 0) {
      console.warn(`[Honeypot Triggered] Blocked bot submission from pkg: ${pkg}`);
      return new Response(JSON.stringify({ success: true, message: "Feedback submitted successfully." }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }

    // 2. 字段基础合法性校验
    if (!category || typeof category !== "string" || !category.trim()) {
      return new Response(JSON.stringify({ success: false, error: "Please select a valid category." }), {
        status: 400,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }

    const trimmedContent = (content || "").trim();
    if (trimmedContent.length < 10 || trimmedContent.length > 1000) {
      return new Response(
        JSON.stringify({
          success: false,
          error: "Feedback content must be between 10 and 1000 characters."
        }),
        {
          status: 400,
          headers: { "Content-Type": "application/json", ...corsHeaders() }
        }
      );
    }

    // 3. Gemini 智能分拣、翻译、严重级判定与垃圾拦截
    const aiAnalysis = await analyzeWithGemini(trimmedContent, category, pkg, env);

    // 4. 垃圾信息判定
    if (aiAnalysis.is_spam) {
      console.info(`[Spam Filtered] Ignored spam feedback for pkg: ${pkg}`);
      return new Response(JSON.stringify({ success: true, message: "Feedback submitted successfully." }), {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      });
    }

    const timeStr = formatCurrentTime();

    // 5. 组装工单记录对象
    const ticketRecord = {
      id: "T-" + Date.now().toString(36),
      time: timeStr,
      pkg,
      category,
      severity: aiAnalysis.severity.toUpperCase(),
      summary: aiAnalysis.summary_zh,
      content: trimmedContent,
      translation: aiAnalysis.translation_zh,
      email: (email || "").trim(),
      ver,
      os,
      extra: typeof extra === "string" ? extra : JSON.stringify(extra || {}),
      status: "待处理"
    };

    // 存入内存缓存（供内置 /sheet 查看）
    IN_MEMORY_TICKETS.unshift(ticketRecord);
    if (IN_MEMORY_TICKETS.length > 500) IN_MEMORY_TICKETS.pop();

    // 6. 异步同步写入在线表格（支持 Google Sheets、飞书多维表格、腾讯文档）
    syncToOnlineSheets(ticketRecord, env).catch(err => {
      console.warn("[Online Sheets Sync Warning]", err.message);
    });

    // 7. 同步创建 GitHub Issue（如果配置了 GitHub Token 则自动推送）
    let issueResult = null;
    const targetRepo = resolveTargetRepo(pkg, env);
    if (env && env.GITHUB_TOKEN && !env.GITHUB_TOKEN.includes("your_token_here")) {
      try {
        issueResult = await createGitHubIssue({
          targetRepo,
          category,
          content: trimmedContent,
          email: (email || "").trim(),
          pkg,
          ver,
          os,
          lang,
          extra,
          aiAnalysis,
          env
        });
      } catch (err) {
        console.warn("[GitHub Issue Push Warning]", err.message);
      }
    }

    return new Response(
      JSON.stringify({
        success: true,
        message: "Feedback submitted successfully.",
        data: {
          ticket_id: ticketRecord.id,
          time: ticketRecord.time,
          category: ticketRecord.category,
          pkg: ticketRecord.pkg,
          issue_number: issueResult?.number || null,
          issue_url: issueResult?.html_url || null
        }
      }),
      {
        status: 200,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      }
    );
  } catch (err) {
    console.error("[Submit Handler Error]", err);
    return new Response(
      JSON.stringify({
        success: false,
        error: "Internal server error. Please try again later."
      }),
      {
        status: 500,
        headers: { "Content-Type": "application/json", ...corsHeaders() }
      }
    );
  }
}

/**
 * 统一同步工单至在线表格矩阵（Google Sheets / 飞书多维表格 / 腾讯文档）
 */
async function syncToOnlineSheets(ticket, env) {
  const syncPromises = [];

  // 1. Google Sheets 通道 (Google Apps Script Web App Webhook)
  const googleWebhook = env && env.GOOGLE_SHEET_WEBHOOK_URL;
  if (googleWebhook && !googleWebhook.includes("your_script_url_here")) {
    syncPromises.push(
      fetch(googleWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ticket),
        redirect: "follow"
      }).catch(err => console.warn("[Google Sheets Sync Warning]", err.message))
    );
  }

  // 2. 飞书多维表格通道 (飞书自动化流程 Webhook)
  const feishuWebhook = env && env.FEISHU_WEBHOOK_URL;
  if (feishuWebhook && !feishuWebhook.includes("your_feishu_webhook_here")) {
    syncPromises.push(
      fetch(feishuWebhook, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(ticket)
      }).catch(err => console.warn("[Feishu Sync Warning]", err.message))
    );
  }

  // 3. 腾讯文档在线表格 (兼容已有通道)
  if (env && env.TENCENT_DOCS_FILE_ID) {
    syncPromises.push(
      appendRowToTencentSheet(ticket, env).catch(err => {
        console.warn("[Tencent Docs Append Warning]", err.message);
      })
    );
  }

  await Promise.allSettled(syncPromises);
}

/**
 * 格式化当前时间为 YYYY-MM-DD HH:mm
 */
function formatCurrentTime() {
  const now = new Date();
  const pad = n => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
}

/**
 * 追加记录至腾讯文档在线表格（SHEET）
 */
async function appendRowToTencentSheet(ticket, env) {
  const token = (env && env.TENCENT_DOCS_TOKEN) || DEFAULT_TENCENT_CONFIG.token;
  const fileId = (env && env.TENCENT_DOCS_FILE_ID) || DEFAULT_TENCENT_CONFIG.fileId;
  const sheetId = (env && env.TENCENT_DOCS_SHEET_ID) || DEFAULT_TENCENT_CONFIG.sheetId;
  const endpoint = DEFAULT_TENCENT_CONFIG.url;

  if (!token || !fileId || !sheetId) return;

  // 1. 查找下一空行行号
  let nextRow = 1;
  try {
    const checkPayload = {
      jsonrpc: "2.0",
      id: Date.now(),
      method: "tools/call",
      params: {
        name: "sheet.get_cell_data",
        arguments: {
          file_id: fileId,
          sheet_id: sheetId,
          start_row: 0,
          end_row: 100,
          start_col: 0,
          end_col: 1
        }
      }
    };

    const res = await fetch(endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", "Authorization": token },
      body: JSON.stringify(checkPayload)
    });

    if (res.ok) {
      const d = await res.json();
      const contentText = d?.result?.content?.[0]?.text;
      if (contentText) {
        const parsed = JSON.parse(contentText);
        const cells = parsed.cells || [];
        const maxRow = cells.reduce((max, c) => Math.max(max, c.row), 0);
        nextRow = maxRow + 1;
      }
    }
  } catch (e) {
    nextRow = IN_MEMORY_TICKETS.length + 1;
  }

  // 2. 写入新行
  const values = [
    { row: nextRow, col: 0, value_type: "STRING", string_value: ticket.time },
    { row: nextRow, col: 1, value_type: "STRING", string_value: ticket.pkg },
    { row: nextRow, col: 2, value_type: "STRING", string_value: ticket.category },
    { row: nextRow, col: 3, value_type: "STRING", string_value: ticket.severity },
    { row: nextRow, col: 4, value_type: "STRING", string_value: ticket.summary },
    { row: nextRow, col: 5, value_type: "STRING", string_value: ticket.content },
    { row: nextRow, col: 6, value_type: "STRING", string_value: ticket.translation },
    { row: nextRow, col: 7, value_type: "STRING", string_value: ticket.email || "未提供" },
    { row: nextRow, col: 8, value_type: "STRING", string_value: ticket.ver },
    { row: nextRow, col: 9, value_type: "STRING", string_value: ticket.os },
    { row: nextRow, col: 10, value_type: "STRING", string_value: ticket.extra },
    { row: nextRow, col: 11, value_type: "STRING", string_value: ticket.status }
  ];

  const writePayload = {
    jsonrpc: "2.0",
    id: Date.now() + 1,
    method: "tools/call",
    params: {
      name: "sheet.set_range_value",
      arguments: {
        file_id: fileId,
        sheet_id: sheetId,
        values: values
      }
    }
  };

  await fetch(endpoint, {
    method: "POST",
    headers: { "Content-Type": "application/json", "Authorization": token },
    body: JSON.stringify(writePayload)
  });
}

/**
 * 路由解析：根据 pkg 解析对应的目标 GitHub 仓库
 */
function resolveTargetRepo(pkg, env) {
  let repoMap = { ...DEFAULT_REPO_MAP };

  if (env && env.REPO_MAP_JSON) {
    try {
      const customMap = JSON.parse(env.REPO_MAP_JSON);
      repoMap = { ...repoMap, ...customMap };
    } catch (e) {
      console.error("[Config Error] Failed to parse REPO_MAP_JSON:", e);
    }
  }

  const defaultRepo = (env && env.GITHUB_DEFAULT_REPO) || repoMap["default"] || "robin421/feedback-inbox";
  return repoMap[pkg] || defaultRepo;
}

/**
 * 调用 Gemini API 进行结构化分析与翻译
 */
async function analyzeWithGemini(content, category, pkg, env) {
  const apiKey = env && env.GEMINI_API_KEY;

  const fallback = {
    is_spam: false,
    summary_zh: content.length > 15 ? content.slice(0, 15) : content,
    translation_zh: content,
    severity: determineFallbackSeverity(category, content),
    category_label: mapFallbackCategory(category)
  };

  if (!apiKey || apiKey.includes("your_gemini_api_key_here")) {
    return fallback;
  }

  const prompt = `You are an automated triage and translation agent for an indie developer software matrix.
The user submitted feedback for project "${pkg}" under category "${category}".
Raw Content:
"""
${content}
"""

Analyze the content and respond strictly with a valid JSON object matching this schema:
{
  "is_spam": boolean,
  "summary_zh": string,
  "translation_zh": string,
  "severity": "high" | "medium" | "low",
  "category_label": "bug" | "enhancement" | "billing" | "question"
}

Field requirements:
- "is_spam": true if the text is pure gibberish, single/meaningless characters, malicious ads, or pure abusive vulgarities without any software issue report. Otherwise false.
- "summary_zh": A clear, concise issue summary in Chinese. MUST NOT exceed 15 Chinese characters.
- "translation_zh": Accurate and natural Chinese translation of the feedback. If the original text is already in Chinese, preserve it as is.
- "severity": "high" if it reports app crash, panic, data loss, failure to connect, billing/payment uncredited; "medium" if it's a normal functional bug or unexpected error; "low" if it's a UI suggestion, usability opinion, or feature request.
- "category_label": "bug" for errors/crashes, "billing" for payment issues, "enhancement" for feature/UI improvements, "question" for usage inquiries.`;

  const modelName = (env && env.GEMINI_MODEL) || "gemini-3-flash-preview";
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

  const requestBody = {
    contents: [{ parts: [{ text: prompt }] }],
    generationConfig: { responseMimeType: "application/json" }
  };

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 5000);

    const res = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    clearTimeout(timeoutId);

    if (!res.ok) return fallback;

    const data = await res.json();
    const candidateText = data?.candidates?.[0]?.content?.parts?.[0]?.text;
    if (!candidateText) return fallback;

    const parsed = JSON.parse(candidateText);
    return {
      is_spam: Boolean(parsed.is_spam),
      summary_zh: typeof parsed.summary_zh === "string" ? parsed.summary_zh.slice(0, 15) : fallback.summary_zh,
      translation_zh: typeof parsed.translation_zh === "string" ? parsed.translation_zh : content,
      severity: ["high", "medium", "low"].includes(parsed.severity) ? parsed.severity : fallback.severity,
      category_label: ["bug", "enhancement", "billing", "question"].includes(parsed.category_label)
        ? parsed.category_label
        : fallback.category_label
    };
  } catch (err) {
    return fallback;
  }
}

function determineFallbackSeverity(category, content) {
  const text = (category + " " + content).toLowerCase();
  if (text.includes("crash") || text.includes("闪退") || text.includes("崩溃") || text.includes("panic") || text.includes("无法连接") || text.includes("扣费") || text.includes("退款")) {
    return "high";
  }
  if (text.includes("建议") || text.includes("feature") || text.includes("希望") || text.includes("request")) {
    return "low";
  }
  return "medium";
}

function mapFallbackCategory(category) {
  const cat = (category || "").toLowerCase();
  if (cat.includes("crash") || cat.includes("报错") || cat.includes("闪退") || cat.includes("bug") || cat.includes("失败")) {
    return "bug";
  }
  if (cat.includes("订阅") || cat.includes("会员") || cat.includes("billing") || cat.includes("pay")) {
    return "billing";
  }
  if (cat.includes("建议") || cat.includes("feature") || cat.includes("不好用") || cat.includes("usability")) {
    return "enhancement";
  }
  return "question";
}

/**
 * 调用 GitHub REST API 创建 Issue
 */
async function createGitHubIssue({
  targetRepo,
  category,
  content,
  email,
  pkg,
  ver,
  os,
  lang,
  extra,
  aiAnalysis,
  env
}) {
  const token = env && env.GITHUB_TOKEN;
  if (!token) return null;

  const issueTitle = `[${category}] ${aiAnalysis.summary_zh} (v${ver || "unknown"})`;
  const labels = [
    "user-feedback",
    `severity:${aiAnalysis.severity}`,
    aiAnalysis.category_label,
    `pkg:${pkg}`
  ];

  let formattedExtra = "None";
  if (extra) {
    try {
      const extraObj = typeof extra === "string" ? JSON.parse(extra) : extra;
      formattedExtra = JSON.stringify(extraObj, null, 2);
    } catch (e) {
      formattedExtra = String(extra);
    }
  }

  const nowIso = new Date().toISOString();
  const issueBody = `### 🤖 AI 智能分拣与中文翻译
- **核心摘要**: ${aiAnalysis.summary_zh}
- **严重等级**: \`${aiAnalysis.severity.toUpperCase()}\`
- **问题分类**: \`${aiAnalysis.category_label}\`
- **中文翻译**:
> ${aiAnalysis.translation_zh.split("\n").join("\n> ")}

---

### 📝 用户原始反馈
> ${content.split("\n").join("\n> ")}

---

### 👤 提交者与分类
- **用户自选分类**: ${category}
- **联系邮箱**: ${email ? `\`${email}\`` : "*未提供 (选填)*"}
- **提交时间 (UTC)**: ${nowIso}

---

### 📱 运行环境
| 字段 | 信息 |
| :--- | :--- |
| **项目标识 (pkg)** | \`${pkg}\` |
| **应用版本 (ver)** | \`${ver}\` |
| **系统平台 (os)** | \`${os}\` |
| **界面语言 (lang)** | \`${lang}\` |

---

### 📦 扩展业务参数 (extra)
\`\`\`json
${formattedExtra}
\`\`\`

> *本工单由 [Feedback-Hub](https://github.com) 自动分拣并推送到目标仓库。*`;

  const githubUrl = `https://api.github.com/repos/${targetRepo}/issues`;

  const response = await fetch(githubUrl, {
    method: "POST",
    headers: {
      "Authorization": `Bearer ${token}`,
      "Accept": "application/vnd.github+json",
      "User-Agent": "Feedback-Hub-Worker",
      "X-GitHub-Api-Version": "2022-11-28",
      "Content-Type": "application/json"
    },
    body: JSON.stringify({
      title: issueTitle,
      body: issueBody,
      labels: labels
    })
  });

  if (!response.ok) return null;
  const responseData = await response.json();
  return {
    number: responseData.number,
    html_url: responseData.html_url
  };
}

/**
 * 前端 HTML 页面模板渲染（移动端 + 桌面端自适应 - 2026 Ultimate Edition）
 * 彻底消除移动端多余 Header，引入 Apple 原生拖拽手柄、分类精巧微图标、输入呼吸环与字数进度条、数字工单凭据 (Ticket Receipt Pass)
 * 支持各个 App 自定义工单内容（标题、描述、分类列表、占位符），并无缝支持客户端默认上传设备语言
 */
function renderHTML({ pkg, ver, os, lang, extra, sheetViewUrl, customTitle = "", customDesc = "", customCategories = "", customPlaceholder = "" }) {
  const serverCustomConfig = {
    title: customTitle || "",
    desc: customDesc || "",
    categories: customCategories || "",
    placeholder: customPlaceholder || ""
  };

  return `<!DOCTYPE html>
<html lang="${({ zh: "zh-CN", "zh-tw": "zh-TW", "zh-hk": "zh-TW", en: "en", ja: "ja", ko: "ko", es: "es", de: "de", fr: "fr" })[lang] || "en"}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0, maximum-scale=1.0, user-scalable=no, viewport-fit=cover">
  <title>Feedback Hub - 用户反馈中心</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'media',
      theme: {
        extend: {
          colors: {
            brand: {
              50: '#eff6ff',
              100: '#dbeafe',
              200: '#bfdbfe',
              500: '#3b82f6',
              600: '#2563eb',
              700: '#1d4ed8',
              800: '#1e40af',
              900: '#1e3a8a',
            }
          },
          fontFamily: {
            sans: ['-apple-system', 'BlinkMacSystemFont', '"SF Pro Text"', '"SF Pro Display"', '"PingFang SC"', '"Segoe UI"', 'Roboto', 'Helvetica', 'Arial', 'sans-serif'],
            mono: ['ui-monospace', 'SFMono-Regular', 'Menlo', 'Monaco', 'Consolas', 'monospace']
          }
        }
      }
    }
  </script>
  <style>
    body {
      -webkit-tap-highlight-color: transparent;
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "PingFang SC", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    textarea, input {
      font-size: 16px !important;
    }
    .ticket-notch-left {
      position: absolute;
      left: -14px;
      top: -12px;
      width: 24px;
      height: 24px;
      border-radius: 9999px;
      background-color: rgb(248 250 252);
    }
    @media (prefers-color-scheme: dark) {
      .ticket-notch-left {
        background-color: #0b0f19;
      }
    }
    .ticket-notch-right {
      position: absolute;
      right: -14px;
      top: -12px;
      width: 24px;
      height: 24px;
      border-radius: 9999px;
      background-color: rgb(248 250 252);
    }
    @media (prefers-color-scheme: dark) {
      .ticket-notch-right {
        background-color: #0b0f19;
      }
    }
  </style>
</head>
<body class="bg-slate-50 text-slate-800 dark:bg-[#0b0f19] dark:text-slate-100 min-h-screen flex flex-col justify-between antialiased selection:bg-brand-500 selection:text-white transition-colors duration-200">

  <!-- 移动端 Webview 沉浸式顶部手柄 (Sheet Handle: 告别生硬 Header 假顶栏) -->
  <div id="sheet-handle" class="sm:hidden flex justify-center pt-2.5 pb-1">
    <div class="w-10 h-1 rounded-full bg-slate-300/80 dark:bg-slate-700/80"></div>
  </div>

  <!-- 主容器：桌面端双栏自适应，移动端流式单列 -->
  <main class="w-full max-w-4xl mx-auto px-4 sm:px-6 lg:px-8 py-3 sm:py-8 lg:py-10 flex-1 flex flex-col justify-center">
    
    <!-- 反馈主卡片 -->
    <div id="form-card" class="bg-white/95 dark:bg-[#111827]/90 rounded-3xl shadow-[0_16px_50px_-12px_rgba(0,0,0,0.06)] dark:shadow-[0_20px_60px_-15px_rgba(0,0,0,0.7)] border border-slate-200/80 dark:border-slate-800/80 backdrop-blur-xl p-4 min-[380px]:p-5 sm:p-8 lg:p-10 transition-all">
      
      <div class="lg:grid lg:grid-cols-12 lg:gap-10 items-stretch">
        
        <!-- 左侧专栏 (桌面端 5 列，移动端置顶，无需独立全局 Header) -->
        <div class="lg:col-span-5 flex flex-col justify-between mb-7 lg:mb-0 lg:border-r lg:border-slate-100 dark:lg:border-slate-800/80 lg:pr-8">
          <div>
            <!-- 产品与状态一体化药丸徽章 + 语言切换器 -->
            <div class="flex items-center justify-between gap-2 mb-4 flex-wrap">
              <div class="flex items-center gap-2 flex-wrap">
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold bg-brand-50 dark:bg-brand-950/60 text-brand-600 dark:text-brand-300 border border-brand-200/70 dark:border-brand-900/60 shadow-2xs">
                  <svg class="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"/>
                  </svg>
                  <span id="badge-pkg">${pkg}</span>
                </span>
                <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[11px] font-medium text-emerald-700 dark:text-emerald-400 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200/60 dark:border-emerald-900/40">
                  <span class="relative flex h-2 w-2">
                    <span class="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    <span class="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
                  </span>
                  <span id="label-live-status">支持团队在线</span>
                </span>
              </div>
              
              <!-- 极简无感多语言切换器 -->
              <div class="relative">
                <select id="lang-selector" onchange="switchLanguage(this.value)" class="text-[11px] bg-slate-100/90 dark:bg-slate-800/90 text-slate-600 dark:text-slate-300 rounded-full px-2.5 py-1 border border-slate-200/70 dark:border-slate-700/70 cursor-pointer outline-none focus:ring-1 focus:ring-brand-500 font-medium transition hover:border-slate-300 dark:hover:border-slate-600">
                  <option value="zh">🇨🇳 简体中文</option>
                  <option value="zh-tw">🇭🇰 繁體中文</option>
                  <option value="en">🇺🇸 English</option>
                  <option value="ja">🇯🇵 日本語</option>
                  <option value="ko">🇰🇷 한국어</option>
                  <option value="es">🇪🇸 Español</option>
                  <option value="de">🇩🇪 Deutsch</option>
                  <option value="fr">🇫🇷 Français</option>
                </select>
              </div>
            </div>
            
            <h1 id="app-title" class="text-2xl sm:text-3xl font-extrabold tracking-tight text-slate-900 dark:text-white mb-2.5 leading-tight">
              <!-- 动态标题 -->
            </h1>
            <p id="app-desc" class="text-xs sm:text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
              <!-- 动态副标题 -->
            </p>

            <!-- 去客服化预期管理卡片 (Stripe 式柔和微光) -->
            <div class="p-3.5 sm:p-4 rounded-2xl bg-amber-50/70 dark:bg-amber-950/25 border border-amber-200/60 dark:border-amber-900/40 text-amber-900 dark:text-amber-200/90 text-xs leading-relaxed flex items-start gap-2.5 mb-6">
              <div class="p-1 rounded-lg bg-amber-100/80 dark:bg-amber-900/50 text-amber-600 dark:text-amber-300 shrink-0 mt-0.5">
                <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2.5">
                  <path stroke-linecap="round" stroke-linejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
              </div>
              <span id="management-notice" class="opacity-90">
                <!-- 动态文案 -->
              </span>
            </div>
          </div>

          <!-- 桌面端快捷键与说明 -->
          <div class="hidden lg:block pt-5 border-t border-slate-100 dark:border-slate-800/80 text-xs text-slate-400 dark:text-slate-500 space-y-2">
            <div class="flex items-center gap-2">
              <kbd class="px-2 py-0.5 bg-slate-100 dark:bg-slate-800 rounded font-mono text-[11px] text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700 shadow-2xs">⌘ + Enter</kbd>
              <span>快捷提交工单</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
              <span>数据直连多维表格矩阵，实时归档</span>
            </div>
          </div>

        </div>

        <!-- 右侧表单专区 (桌面端 7 列) -->
        <div class="lg:col-span-7 flex flex-col justify-between">
          <form id="feedback-form" onsubmit="return false;" novalidate>
            
            <!-- 防垃圾蜜罐字段 (保持安全无损) -->
            <input type="text" name="website_url" id="website_url" value="" autocomplete="off" style="position: absolute; left: -9999px; opacity: 0; pointer-events: none;" tabindex="-1" aria-hidden="true" />

            <!-- 1. 问题分类（图标卡片网格组） -->
            <div class="mb-5">
              <div class="flex items-center justify-between mb-2">
                <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400" id="label-category">
                  问题分类 <span class="text-rose-500">*</span>
                </label>
                <span class="text-[11px] text-slate-400 dark:text-slate-500" id="category-hint">请选择最符合的一项</span>
              </div>
              <div id="category-group" class="grid grid-cols-1 sm:grid-cols-2 gap-2 sm:gap-2.5">
                <!-- 动态生成带有精美微图标的分类按钮 -->
              </div>
              <p id="category-error" class="hidden text-xs text-rose-500 mt-1.5 flex items-center gap-1"></p>
            </div>

            <!-- 2. 详细描述 (含快捷清空与动态字数进度条) -->
            <div class="mb-5">
              <div class="flex justify-between items-center mb-1.5">
                <label for="content" class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400" id="label-content">
                  详细描述 <span class="text-rose-500">*</span>
                </label>
                <div class="flex items-center gap-2">
                  <button type="button" id="btn-clear-content" onclick="clearContent()" class="hidden text-[11px] font-medium text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 transition-colors flex items-center gap-0.5 py-0.5 px-1 rounded hover:bg-slate-100 dark:hover:bg-slate-800">
                    <svg class="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                      <path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                    <span id="label-clear">清空</span>
                  </button>
                  <span id="char-count" class="text-xs font-mono text-slate-400 dark:text-slate-500 font-medium">0 / 1000</span>
                </div>
              </div>

              <!-- 输入框容器 + 底部极细进度条 -->
              <div class="relative rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-900/50 focus-within:ring-2 focus-within:ring-brand-500/25 focus-within:border-brand-500 transition-all shadow-2xs">
                <textarea
                  id="content"
                  name="content"
                  rows="5"
                  maxlength="1000"
                  class="w-full px-4 py-3 bg-transparent text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none resize-none leading-relaxed text-sm block"
                  placeholder=""
                ></textarea>
                <!-- 动态字数进度微线条 -->
                <div class="h-1 w-full bg-slate-100 dark:bg-slate-800/80 overflow-hidden">
                  <div id="char-progress" class="h-full bg-slate-300 dark:bg-slate-600 transition-all duration-150 rounded-full" style="width: 0%"></div>
                </div>
              </div>

              <div class="flex justify-between items-center mt-1.5 px-0.5">
                <p id="content-hint" class="text-xs text-slate-400 dark:text-slate-500"></p>
                <p id="content-error" class="hidden text-xs text-rose-500"></p>
              </div>
            </div>

            <!-- 3. 联系邮箱 (选填，带内联图标) -->
            <div class="mb-6">
              <label for="email" class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5" id="label-email">
                联系邮箱 (选填)
              </label>
              <div class="relative">
                <div class="absolute inset-y-0 left-0 pl-3.5 flex items-center pointer-events-none text-slate-400">
                  <svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
                    <path stroke-linecap="round" stroke-linejoin="round" d="M3 8l7.89 5.26a2 2 0 002.22 0L21 8M5 19h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v10a2 2 0 002 2z" />
                  </svg>
                </div>
                <input
                  type="email"
                  id="email"
                  name="email"
                  class="w-full pl-10 pr-4 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700/80 bg-slate-50/60 dark:bg-slate-900/50 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500/25 focus:border-brand-500 transition-all text-sm shadow-2xs"
                  placeholder=""
                />
              </div>
            </div>

            <!-- 提交主按钮 (Linear 级微质感渐变) -->
            <button
              type="button"
              id="btn-submit"
              onclick="submitFeedback()"
              class="w-full py-3.5 px-6 rounded-2xl font-semibold text-sm text-white bg-gradient-to-r from-blue-600 via-brand-600 to-indigo-600 hover:from-blue-500 hover:to-indigo-500 active:scale-[0.98] focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 dark:focus:ring-offset-slate-900 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 transition-all shadow-md shadow-brand-500/20 flex items-center justify-center gap-2 cursor-pointer"
            >
              <svg id="submit-spinner" class="hidden animate-spin h-4 w-4 text-white" fill="none" viewBox="0 0 24 24">
                <circle class="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" stroke-width="4"></circle>
                <path class="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8v8H4z"></path>
              </svg>
              <span id="submit-text">提交反馈</span>
            </button>

          </form>
        </div>

      </div>

    </div>

    <!-- 提交成功状态卡片：数字工单凭据 (Ticket Receipt Pass) -->
    <div id="success-card" class="hidden bg-white/95 dark:bg-[#111827]/90 rounded-3xl shadow-[0_20px_60px_-15px_rgba(0,0,0,0.1)] dark:shadow-[0_25px_70px_-20px_rgba(0,0,0,0.8)] border border-slate-200/80 dark:border-slate-800/80 overflow-hidden text-left transition-all max-w-lg mx-auto w-full">
      
      <!-- 凭据头部 (深蓝沉浸质感) -->
      <div class="bg-gradient-to-br from-slate-900 via-indigo-950 to-slate-900 text-white p-6 sm:p-7 relative overflow-hidden">
        <div class="absolute -right-6 -bottom-6 w-32 h-32 rounded-full bg-brand-500/10 blur-2xl pointer-events-none"></div>
        <div class="flex items-center justify-between mb-4">
          <div class="flex items-center gap-2">
            <div class="w-8 h-8 rounded-xl bg-emerald-500/20 border border-emerald-400/30 text-emerald-400 flex items-center justify-center shadow-inner">
              <svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2.5">
                <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7"></path>
              </svg>
            </div>
            <div>
              <span class="text-[10px] uppercase font-bold tracking-widest text-slate-400 block">Electronic Pass</span>
              <h2 id="success-title" class="text-base font-bold text-white tracking-tight">工单已归档入库</h2>
            </div>
          </div>
          <span class="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-[10px] font-semibold bg-emerald-500/10 text-emerald-300 border border-emerald-500/30">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping"></span>
            <span id="ticket-status-badge">已入排期队列</span>
          </span>
        </div>
        <p id="success-desc" class="text-xs text-slate-300/80 leading-relaxed">
          您的反馈已自动直连多维表格看板并生成唯一存证凭据。
        </p>
      </div>

      <!-- 中间撕裂虚线与票据圆槽 (Ticket Perforation & Notches) -->
      <div class="relative py-2 bg-slate-50/50 dark:bg-[#0d131f]/50">
        <div class="ticket-notch-left"></div>
        <div class="ticket-notch-right"></div>
        <div class="border-t border-dashed border-slate-200 dark:border-slate-800 mx-5"></div>
      </div>

      <!-- 凭据核心数据区 -->
      <div class="p-5 sm:p-6 space-y-4">
        
        <!-- 工单编号与一键复制 -->
        <div class="flex items-center justify-between p-3.5 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-200/60 dark:border-slate-800">
          <div>
            <span class="text-[10px] uppercase font-semibold text-slate-400 block tracking-wider">Ticket ID</span>
            <span id="ticket-id-display" class="font-mono text-sm sm:text-base font-extrabold text-brand-600 dark:text-brand-400 tracking-wider">T-Pending</span>
          </div>
          <button
            type="button"
            id="btn-copy-id"
            onclick="copyTicketId()"
            class="inline-flex items-center gap-1 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 shadow-2xs hover:bg-slate-50 dark:hover:bg-slate-700 active:scale-95 transition cursor-pointer"
          >
            <svg id="copy-icon" class="w-3.5 h-3.5 text-slate-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
              <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
              <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
            </svg>
            <span id="copy-text">复制单号</span>
          </button>
        </div>

        <!-- 四项元数据网格 -->
        <div class="grid grid-cols-2 gap-3 text-xs">
          <div class="p-2.5 rounded-xl bg-slate-50/70 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
            <span id="ticket-label-pkg" class="text-slate-400 text-[11px] block">所属应用</span>
            <span id="ticket-pkg-display" class="font-semibold text-slate-800 dark:text-slate-200 truncate block mt-0.5">${pkg}</span>
          </div>
          <div class="p-2.5 rounded-xl bg-slate-50/70 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
            <span id="ticket-label-cat" class="text-slate-400 text-[11px] block">问题类别</span>
            <span id="ticket-cat-display" class="font-semibold text-slate-800 dark:text-slate-200 truncate block mt-0.5">程序报错</span>
          </div>
          <div class="p-2.5 rounded-xl bg-slate-50/70 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
            <span id="ticket-label-email" class="text-slate-400 text-[11px] block">联系方式</span>
            <span id="ticket-email-display" class="font-mono text-slate-700 dark:text-slate-300 truncate block mt-0.5">未提供</span>
          </div>
          <div class="p-2.5 rounded-xl bg-slate-50/70 dark:bg-slate-900/40 border border-slate-100 dark:border-slate-800">
            <span id="ticket-label-time" class="text-slate-400 text-[11px] block">提交时间</span>
            <span id="ticket-time-display" class="font-mono text-slate-700 dark:text-slate-300 truncate block mt-0.5">刚刚</span>
          </div>
        </div>

        <!-- 提交内容快照折叠框 -->
        <div class="p-3 bg-slate-50 dark:bg-slate-900/40 rounded-2xl border border-slate-200/60 dark:border-slate-800">
          <div class="flex items-center justify-between mb-1.5">
            <span id="ticket-label-content" class="text-[11px] font-semibold text-slate-400">已存档描述快照:</span>
            <span class="text-[10px] text-slate-400 font-mono">1:1 Raw</span>
          </div>
          <div id="ticket-content-display" class="p-2.5 bg-white dark:bg-slate-950/60 rounded-xl border border-slate-200/50 dark:border-slate-800 text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed max-h-32 overflow-y-auto font-sans text-xs"></div>
        </div>

        <!-- 操作按钮组 -->
        <div class="pt-2 flex flex-col sm:flex-row gap-2.5">
          <button
            type="button"
            onclick="copySummary()"
            id="btn-copy-summary"
            class="w-full sm:w-1/2 py-3 px-4 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 active:scale-[0.99] transition text-center cursor-pointer"
          >
            复制凭证摘要
          </button>
          <button
            type="button"
            onclick="resetForm()"
            id="btn-back"
            class="w-full sm:w-1/2 py-3 px-4 rounded-xl text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 active:scale-[0.99] transition shadow-sm text-center cursor-pointer"
          >
            返回 / 再次提交
          </button>
        </div>

      </div>

    </div>

    <!-- 底部环境参数与微小管理入口 -->
    <footer class="mt-6 text-center select-none">
      <div id="env-footer" class="text-xs font-mono text-slate-400 dark:text-slate-500 leading-relaxed">
        <!-- 自动渲染环境参数 -->
      </div>
      <div class="mt-1.5 text-[11px] text-slate-400/70 dark:text-slate-600">
        Feedback Hub · 独立产品支持中心<span id="admin-link"> · <a href="/sheet" class="hover:underline hover:text-slate-600 dark:hover:text-slate-400 transition-colors">管理视图</a></span>
      </div>
    </footer>

  </main>

  <script>
    const SERVER_CUSTOM_CONFIG = ${JSON.stringify(serverCustomConfig)};
    const APP_CONFIG = {
      "default": {
        name: {
          zh: "用户问题与建议反馈",
          "zh-tw": "用戶問題與建議反饋",
          en: "Feedback Center",
          ja: "ユーザーフィードバック",
          ko: "고객 지원 및 피드백",
          es: "Centro de comentarios",
          de: "Feedback-Zentrum",
          fr: "Centre de retours"
        },
        desc: {
          zh: "感谢您的宝贵意见，我们专注于以代码改进体验，所有工单自动沉淀至团队在线表格",
          "zh-tw": "感謝您的寶貴意見，我們專注於以代碼改進體驗，所有工單自動沉澱至團隊在線表格",
          en: "Help us improve product experience. Tickets are synced directly to our engineering spreadsheet.",
          ja: "ご意見ありがとうございます。チームで確認し、コードの改善に役立てます。",
          ko: "소중한 의견 감사드립니다. 모든 피드백은 개발팀 스프레드시트에 자동 수집됩니다.",
          es: "Gracias por sus comentarios. Nos enfocamos en mejorar el código continuamente.",
          de: "Vielen Dank für Ihre Rückmeldung. Wir konzentrieren uns auf kontinuierliche Code-Verbesserungen.",
          fr: "Merci pour vos retours. Nous nous concentrons sur l'amélioration continue du code."
        },
        categories: {
          zh: ["程序报错/闪退", "功能不好用", "新功能建议", "其他问题"],
          "zh-tw": ["程式報錯/閃退", "功能不好用", "新功能建議", "其他問題"],
          en: ["Bug / Crash", "Usability", "Feature Request", "Other"],
          ja: ["バグ・不具合", "操作性・UI", "新機能の提案", "その他"],
          ko: ["오류 / 강제종료", "사용성 불편", "새 기능 제안", "기타 문의"],
          es: ["Error / Fallo", "Usabilidad", "Sugerencia", "Otro"],
          de: ["Fehler / Absturz", "Bedienbarkeit", "Funktionswunsch", "Sonstiges"],
          fr: ["Bug / Panne", "Ergonomie", "Suggestion", "Autre"]
        }
      },
      "aisubdeal": {
        name: {
          zh: "AiSubDeal 订阅比价助手",
          "zh-tw": "AiSubDeal 訂閱比價助手",
          en: "AiSubDeal Feedback",
          ja: "AiSubDeal サブスク比較アシスタント",
          ko: "AiSubDeal 구독 비교 어시스턴트",
          es: "AiSubDeal Comparador de suscripciones",
          de: "AiSubDeal Abo-Vergleichsassistent",
          fr: "AiSubDeal Comparateur d'abonnements"
        },
        desc: {
          zh: "价格追踪、汇率换算与各平台订阅信息反馈",
          "zh-tw": "價格追蹤、匯率換算與各平台訂閱資訊反饋",
          en: "Feedback for price tracking, exchange rates and subscriptions",
          ja: "価格追跡・為替換算・各プラットフォームのサブスク情報に関するフィードバック",
          ko: "가격 추적, 환율 계산 및 구독 정보 피드백",
          es: "Seguimiento de precios, tipos de cambio y suscripciones",
          de: "Feedback zu Preisverfolgung, Wechselkursen und Abonnements",
          fr: "Retours sur le suivi des prix, les devises et les abonnements"
        },
        categories: {
          zh: ["价格不准", "汇率问题", "功能建议", "其他"],
          "zh-tw": ["價格不準", "匯率問題", "功能建議", "其他"],
          en: ["Price Inaccurate", "Currency Issue", "Feature Request", "Other"],
          ja: ["価格が不正確", "為替レートの問題", "新機能の提案", "その他"],
          ko: ["가격 불일치", "환율 오류", "기능 건의", "기타"],
          es: ["Precio inexacto", "Problema de cambio", "Sugerencia", "Otro"],
          de: ["Preis ungenau", "Wechselkursproblem", "Funktionswunsch", "Sonstiges"],
          fr: ["Prix inexact", "Problème de devise", "Suggestion", "Autre"]
        }
      },
      "fitflow": {
        name: {
          zh: "FitFlow 健身计划",
          "zh-tw": "FitFlow 健身計劃",
          en: "FitFlow Feedback",
          ja: "FitFlow ワークアウト管理",
          ko: "FitFlow 운동 루틴 플래너",
          es: "FitFlow Planificador de fitness",
          de: "FitFlow Trainingsplaner",
          fr: "FitFlow Planificateur de fitness"
        },
        desc: {
          zh: "动作库、周期记录与训练数据同步反馈",
          "zh-tw": "動作庫、週期記錄與訓練數據同步反饋",
          en: "Workout tracking, exercise routines and sync feedback",
          ja: "種目ライブラリ・記録・データ同期に関するフィードバック",
          ko: "운동 라이브러리, 일지 및 데이터 동기화 피드백",
          es: "Biblioteca de ejercicios, registro y sincronización",
          de: "Übungsbibliothek, Verlauf und Daten-Synchronisation",
          fr: "Exercices, suivi et synchronisation des données"
        },
        categories: {
          zh: ["数据同步失败", "动作库建议", "界面优化", "其他"],
          "zh-tw": ["數據同步失敗", "動作庫建議", "界面優化", "其他"],
          en: ["Sync Failed", "Exercise Request", "UI Improvement", "Other"],
          ja: ["同期エラー", "種目の追加要望", "UI改善", "その他"],
          ko: ["동기화 오류", "운동 추가 요청", "UI 개선", "기타"],
          es: ["Error de sincronización", "Solicitud de ejercicio", "Mejora de interfaz", "Otro"],
          de: ["Sync fehlgeschlagen", "Übungsvorschlag", "UI-Verbesserung", "Sonstiges"],
          fr: ["Échec de synchro", "Nouvel exercice", "Amélioration UI", "Autre"]
        }
      }
    };

    const I18N = {
      zh: {
        categoryLabel: "问题分类",
        categoryHint: "请选择最符合的一项",
        contentLabel: "详细描述",
        contentPlaceholder: "请详细描述您遇到的问题现象、复现步骤或期望，帮助我们准确定位（10~1000字）...",
        contentHint: "至少输入 10 个字符",
        clearText: "清空",
        emailLabel: "联系邮箱 (选填)",
        emailPlaceholder: "选填：仅在修复重大问题或需要补充信息时通知您",
        submitText: "提交反馈",
        submittingText: "提交中...",
        rateLimitText: "请稍候 {sec}s 后再提交",
        managementNotice: "感谢反馈！每一条工单都会直达开发排期队列。作为独立开发团队我们专注于代码改进，通常不会进行人工一对一回复，重大进展会通过邮箱通知。",
        liveStatusText: "技术支持在线",
        successTitle: "工单已归档入库",
        successDesc: "您的反馈已自动直连多维表格看板并生成唯一存证凭据。",
        btnBack: "返回 / 再次提交",
        btnDone: "完成",
        btnCopySummary: "复制凭证摘要",
        copied: "已复制",
        copyId: "复制单号",
        summaryCopied: "凭证摘要已复制到剪贴板",
        selectCategoryError: "请选择一个问题分类",
        contentLengthError: "内容长度需在 10 至 1000 字之间",
        anonymous: "匿名提交",
        ticketIdLabel: "工单编号",
        pkgLabel: "所属应用",
        catLabel: "问题类别",
        emailMetaLabel: "联系方式",
        timeLabel: "提交时间",
        contentMetaLabel: "已存档描述快照",
        statusBadgeText: "已入排期队列",
        justNow: "刚刚"
      },
      "zh-tw": {
        categoryLabel: "問題分類",
        categoryHint: "請選擇最符合的一項",
        contentLabel: "詳細描述",
        contentPlaceholder: "請詳細描述您遇到的問題現象、復現步驟或期望，幫助我們準確定位（10~1000字）...",
        contentHint: "至少輸入 10 個字符",
        clearText: "清空",
        emailLabel: "聯絡信箱 (選填)",
        emailPlaceholder: "選填：僅在修復重大問題或需要補充資訊時通知您",
        submitText: "提交反饋",
        submittingText: "提交中...",
        rateLimitText: "請稍候 {sec}s 後再提交",
        managementNotice: "感謝反饋！每一條工單都會直達開發排期隊列。作為獨立開發團隊我們專注於代碼改進，通常不會進行人工一對一回覆，重大進展會通過郵箱通知。",
        liveStatusText: "技術支援在線",
        successTitle: "工單已歸檔入庫",
        successDesc: "您的反饋已自動直連多維表格看板並生成唯一存證憑據。",
        btnBack: "返回 / 再次提交",
        btnDone: "完成",
        btnCopySummary: "複製憑證摘要",
        copied: "已複製",
        copyId: "複製單號",
        summaryCopied: "憑證摘要已複製到剪貼簿",
        selectCategoryError: "請選擇一個問題分類",
        contentLengthError: "內容長度需在 10 至 1000 字之間",
        anonymous: "匿名提交",
        ticketIdLabel: "工單編號",
        pkgLabel: "所屬應用",
        catLabel: "問題類別",
        emailMetaLabel: "聯絡方式",
        timeLabel: "提交時間",
        contentMetaLabel: "已存檔描述快照",
        statusBadgeText: "已入排期隊列",
        justNow: "剛剛"
      },
      en: {
        categoryLabel: "Category",
        categoryHint: "Select the most relevant",
        contentLabel: "Detailed Description",
        contentPlaceholder: "Please describe what happened, steps to reproduce, or suggestions (10-1000 chars)...",
        contentHint: "At least 10 characters required",
        clearText: "Clear",
        emailLabel: "Contact Email (Optional)",
        emailPlaceholder: "Optional: Only for critical updates or clarifications",
        submitText: "Submit Ticket",
        submittingText: "Submitting...",
        rateLimitText: "Please wait {sec}s",
        managementNotice: "Thank you! Every ticket is routed directly to our engineering backlog. As an indie team we focus 100% on shipping code improvements and generally do not offer 1-on-1 support; major updates will be emailed.",
        liveStatusText: "Support Online",
        successTitle: "Ticket Recorded",
        successDesc: "Your feedback has been routed to our spreadsheet backlog with a permanent receipt.",
        btnBack: "Submit Another",
        btnDone: "Done",
        btnCopySummary: "Copy Summary",
        copied: "Copied",
        copyId: "Copy ID",
        summaryCopied: "Receipt summary copied to clipboard",
        selectCategoryError: "Please choose a category",
        contentLengthError: "Description must be between 10 and 1000 characters",
        anonymous: "Anonymous",
        ticketIdLabel: "Ticket ID",
        pkgLabel: "Product",
        catLabel: "Category",
        emailMetaLabel: "Contact",
        timeLabel: "Submitted At",
        contentMetaLabel: "Archived Snapshot",
        statusBadgeText: "Queued for Review",
        justNow: "Just now"
      },
      ja: {
        categoryLabel: "カテゴリ",
        categoryHint: "最も当てはまるものを選択",
        contentLabel: "詳細な説明",
        contentPlaceholder: "発生した現象、再現手順、またはご要望をご記入ください（10〜1000文字）...",
        contentHint: "10文字以上入力してください",
        clearText: "クリア",
        emailLabel: "連絡先メールアドレス (任意)",
        emailPlaceholder: "任意：重要な修正や確認が必要な場合のみご連絡します",
        submitText: "フィードバックを送信",
        submittingText: "送信中...",
        rateLimitText: "{sec}秒後にお試しください",
        managementNotice: "フィードバックありがとうございます！すべてのチケットは開発バックログに直接記録されます。個人開発チームとしてコードの改善に専念しており、原則として個別返信は行っておりません。重要な進捗はメールでお知らせします。",
        liveStatusText: "サポート受付中",
        successTitle: "チケットを登録しました",
        successDesc: "フィードバックはスプレッドシートに記録され、専用の証明控えが発行されました。",
        btnBack: "別のフィードバックを送信",
        btnDone: "完了",
        btnCopySummary: "控えをコピー",
        copied: "コピー完了",
        copyId: "IDをコピー",
        summaryCopied: "控えの内容をクリップボードにコピーしました",
        selectCategoryError: "カテゴリを選択してください",
        contentLengthError: "説明は10文字以上1000文字以内で入力してください",
        anonymous: "匿名",
        ticketIdLabel: "チケット番号",
        pkgLabel: "対象製品",
        catLabel: "カテゴリ",
        emailMetaLabel: "連絡先",
        timeLabel: "送信日時",
        contentMetaLabel: "送信内容の控え",
        statusBadgeText: "確認待ち",
        justNow: "たった今"
      },
      ko: {
        categoryLabel: "카테고리",
        categoryHint: "가장 적합한 항목 선택",
        contentLabel: "상세 설명",
        contentPlaceholder: "발생한 문제, 재현 단계 또는 건의사항을 자세히 적어주세요 (10~1000자)...",
        contentHint: "최소 10자 이상 입력해주세요",
        clearText: "지우기",
        emailLabel: "연락처 이메일 (선택)",
        emailPlaceholder: "선택사항: 중요한 수정사항이나 확인이 필요한 경우에만 연락드립니다",
        submitText: "피드백 제출",
        submittingText: "제출 중...",
        rateLimitText: "{sec}초 후에 다시 시도해주세요",
        managementNotice: "피드백 감사합니다! 모든 티켓은 개발 대기열에 직접 등록됩니다. 1인/소규모 개발팀으로서 코드 개선에 집중하고 있어 개별 1:1 답변은 어려울 수 있으며, 중요한 진행 상황은 이메일로 안내해 드립니다.",
        liveStatusText: "지원 접수 중",
        successTitle: "티켓이 등록되었습니다",
        successDesc: "피드백이 스프레드시트에 정상 등록되었으며 고유 접수증이 발급되었습니다.",
        btnBack: "추가 피드백 제출",
        btnDone: "완료",
        btnCopySummary: "접수 요약 복사",
        copied: "복사됨",
        copyId: "ID 복사",
        summaryCopied: "접수 요약이 클립보드에 복사되었습니다",
        selectCategoryError: "카테고리를 선택해주세요",
        contentLengthError: "내용은 10자 이상 1000자 이하여야 합니다",
        anonymous: "익명",
        ticketIdLabel: "티켓 번호",
        pkgLabel: "대상 제품",
        catLabel: "카테고리",
        emailMetaLabel: "연락처",
        timeLabel: "접수 시간",
        contentMetaLabel: "접수 내용 스냅샷",
        statusBadgeText: "검토 대기 중",
        justNow: "방금 전"
      },
      es: {
        categoryLabel: "Categoría",
        categoryHint: "Seleccione la más adecuada",
        contentLabel: "Descripción detallada",
        contentPlaceholder: "Describa el problema, pasos para reproducirlo o sugerencias (10-1000 caracteres)...",
        contentHint: "Se requieren al menos 10 caracteres",
        clearText: "Borrar",
        emailLabel: "Correo de contacto (Opcional)",
        emailPlaceholder: "Opcional: solo para actualizaciones críticas o aclaraciones",
        submitText: "Enviar ticket",
        submittingText: "Enviando...",
        rateLimitText: "Espere {sec}s",
        managementNotice: "¡Gracias por sus comentarios! Cada ticket se envía directamente a nuestro backlog de desarrollo. Como equipo independiente nos centramos en mejorar el código y generalmente no ofrecemos atención individual; las actualizaciones importantes se notificarán por correo.",
        liveStatusText: "Soporte activo",
        successTitle: "Ticket registrado",
        successDesc: "Sus comentarios se han sincronizado con la hoja de cálculo con un comprobante permanente.",
        btnBack: "Enviar otro ticket",
        btnDone: "Listo",
        btnCopySummary: "Copiar resumen",
        copied: "Copiado",
        copyId: "Copiar ID",
        summaryCopied: "Resumen del comprobante copiado al portapapeles",
        selectCategoryError: "Seleccione una categoría",
        contentLengthError: "La descripción debe tener entre 10 y 1000 caracteres",
        anonymous: "Anónimo",
        ticketIdLabel: "ID del ticket",
        pkgLabel: "Producto",
        catLabel: "Categoría",
        emailMetaLabel: "Contacto",
        timeLabel: "Enviado el",
        contentMetaLabel: "Instantánea archivada",
        statusBadgeText: "En cola de revisión",
        justNow: "Ahora mismo"
      },
      de: {
        categoryLabel: "Kategorie",
        categoryHint: "Wählen Sie die passendste",
        contentLabel: "Detaillierte Beschreibung",
        contentPlaceholder: "Beschreiben Sie das Problem, Reproduktionsschritte oder Vorschläge (10-1000 Zeichen)...",
        contentHint: "Mindestens 10 Zeichen erforderlich",
        clearText: "Löschen",
        emailLabel: "Kontakt-E-Mail (Optional)",
        emailPlaceholder: "Optional: Nur für wichtige Updates oder Rückfragen",
        submitText: "Feedback senden",
        submittingText: "Wird gesendet...",
        rateLimitText: "Bitte warten Sie {sec}s",
        managementNotice: "Vielen Dank für Ihr Feedback! Jedes Ticket fließt direkt in unser Entwicklungs-Backlog ein. Als Indie-Team konzentrieren wir uns auf Code-Verbesserungen und bieten in der Regel keinen 1-zu-1-Support; wichtige Updates erhalten Sie per E-Mail.",
        liveStatusText: "Support online",
        successTitle: "Ticket erfasst",
        successDesc: "Ihr Feedback wurde in unserer Tabelle erfasst und ein Beleg erstellt.",
        btnBack: "Weiteres Feedback",
        btnDone: "Fertig",
        btnCopySummary: "Zusammenfassung kopieren",
        copied: "Kopiert",
        copyId: "ID kopieren",
        summaryCopied: "Belegzusammenfassung in die Zwischenablage kopiert",
        selectCategoryError: "Bitte wählen Sie eine Kategorie",
        contentLengthError: "Die Beschreibung muss zwischen 10 und 1000 Zeichen lang sein",
        anonymous: "Anonym",
        ticketIdLabel: "Ticket-ID",
        pkgLabel: "Produkt",
        catLabel: "Kategorie",
        emailMetaLabel: "Kontakt",
        timeLabel: "Eingereicht am",
        contentMetaLabel: "Archivierter Beleg",
        statusBadgeText: "In Warteschlange",
        justNow: "Gerade eben"
      },
      fr: {
        categoryLabel: "Catégorie",
        categoryHint: "Sélectionnez la plus pertinente",
        contentLabel: "Description détaillée",
        contentPlaceholder: "Veuillez décrire le problème, les étapes de reproduction ou vos suggestions (10-1000 caractères)...",
        contentHint: "Au moins 10 caractères requis",
        clearText: "Effacer",
        emailLabel: "E-mail de contact (Optionnel)",
        emailPlaceholder: "Optionnel : uniquement pour les mises à jour critiques",
        submitText: "Envoyer le ticket",
        submittingText: "Envoi en cours...",
        rateLimitText: "Veuillez patienter {sec}s",
        managementNotice: "Merci pour votre retour ! Chaque ticket est directement transmis à notre file de développement. En tant qu'équipe indépendante, nous nous concentrons sur l'amélioration du code et n'offrons généralement pas de support 1-à-1 ; les mises à jour majeures seront envoyées par e-mail.",
        liveStatusText: "Support en ligne",
        successTitle: "Ticket enregistré",
        successDesc: "Votre retour a été enregistré dans notre tableau avec un reçu permanent.",
        btnBack: "Envoyer un autre",
        btnDone: "Terminé",
        btnCopySummary: "Copier le résumé",
        copied: "Copié",
        copyId: "Copier l'ID",
        summaryCopied: "Résumé du reçu copié dans le presse-papiers",
        selectCategoryError: "Veuillez choisir une catégorie",
        contentLengthError: "La description doit contenir entre 10 et 1000 caractères",
        anonymous: "Anonyme",
        ticketIdLabel: "N° de ticket",
        pkgLabel: "Produit",
        catLabel: "Catégorie",
        emailMetaLabel: "Contact",
        timeLabel: "Soumis le",
        contentMetaLabel: "Aperçu archivé",
        statusBadgeText: "En attente de révision",
        justNow: "À l'instant"
      }
    };

    function getI18n(lang) {
      return I18N[lang] || I18N["en"];
    }

    function normalizeLang(lang) {
      if (!lang) return "en";
      const l = lang.toLowerCase();
      if (l.startsWith("zh-tw") || l.startsWith("zh-hk") || l.startsWith("zh-mo") || l.startsWith("zh-hant")) return "zh-tw";
      if (l.startsWith("zh")) return "zh";
      if (l.startsWith("ja")) return "ja";
      if (l.startsWith("ko")) return "ko";
      if (l.startsWith("es")) return "es";
      if (l.startsWith("de")) return "de";
      if (l.startsWith("fr")) return "fr";
      return "en";
    }

    // 智能获取精美 Lucide 矢量图标（支持 8 语种多语言关键字匹配）
    function getCategoryIconSvg(catName) {
      const name = (catName || "").toLowerCase();
      // 1. Bug / Crash 类 (中英日韩西德法)
      if (name.includes("报错") || name.includes("闪退") || name.includes("報錯") || name.includes("bug") || name.includes("crash") || name.includes("失败") || name.includes("失敗") || name.includes("不准") || name.includes("不準") || name.includes("バグ") || name.includes("不具合") || name.includes("오류") || name.includes("강제종료") || name.includes("error") || name.includes("fallo") || name.includes("fehler") || name.includes("absturz") || name.includes("panne")) {
        return '<svg class="w-4 h-4 text-rose-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m8 2 1.88 1.88"/><path d="M14.12 3.88 16 2"/><path d="M9 7.13v-1a3.003 3.003 0 1 1 6 0v1"/><path d="M12 20c-3.3 0-6-2.7-6-6v-3a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v3c0 3.3-2.7 6-6 6"/><path d="M12 20v-9"/><path d="M6.53 9C4.6 8.8 3 7.1 3 5"/><path d="M6 13H2"/><path d="M3 21c0-2.1 1.7-3.9 3.8-4"/><path d="M20.97 5c0 2.1-1.6 3.8-3.5 4"/><path d="M22 13h-4"/><path d="M17.2 17c2.1.1 3.8 1.9 3.8 4"/></svg>';
      // 2. 体验 / UI / 调优类
      } else if (name.includes("不好用") || name.includes("体验") || name.includes("體驗") || name.includes("优化") || name.includes("優化") || name.includes("ui") || name.includes("usability") || name.includes("汇率") || name.includes("匯率") || name.includes("操作") || name.includes("使いづらい") || name.includes("改善") || name.includes("불편") || name.includes("usabilidad") || name.includes("bedienbarkeit") || name.includes("ergonomie")) {
        return '<svg class="w-4 h-4 text-indigo-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="4" x2="4" y1="21" y2="14"/><line x1="4" x2="4" y1="10" y2="3"/><line x1="12" x2="12" y1="21" y2="12"/><line x1="12" x2="12" y1="8" y2="3"/><line x1="20" x2="20" y1="21" y2="16"/><line x1="20" x2="20" y1="12" y2="3"/><line x1="1" x2="7" y1="14" y2="14"/><line x1="9" x2="15" y1="8" y2="8"/><line x1="17" x2="23" y1="16" y2="16"/></svg>';
      // 3. 新功能建议 / 灵感
      } else if (name.includes("新功能") || name.includes("建议") || name.includes("建議") || name.includes("feature") || name.includes("request") || name.includes("提案") || name.includes("要望") || name.includes("제안") || name.includes("sugerencia") || name.includes("vorschlag") || name.includes("suggestion") || name.includes("wunsch")) {
        return '<svg class="w-4 h-4 text-amber-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m12 3-1.912 5.813a2 2 0 0 1-1.275 1.275L3 12l5.813 1.912a2 2 0 0 1 1.275 1.275L12 21l1.912-5.813a2 2 0 0 1 1.275-1.275L21 12l-5.813-1.912a2 2 0 0 1-1.275-1.275L12 3Z"/><path d="M5 3v4"/><path d="M19 17v4"/><path d="M3 5h4"/><path d="M17 19h4"/></svg>';
      // 4. 其他 / 咨询
      } else {
        return '<svg class="w-4 h-4 text-emerald-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>';
      }
    }

    const queryParams = new URLSearchParams(window.location.search);
    const clientPkg = queryParams.get("pkg") || "${pkg}";
    const clientVer = queryParams.get("ver") || "${ver}";
    const clientOs = queryParams.get("os") || (navigator.userAgent.includes("Android") ? "Android" : navigator.userAgent.includes("iPhone") ? "iOS" : "Desktop Browser");
    const rawParamLang = queryParams.get("lang") || "${lang}" || (typeof navigator !== "undefined" ? navigator.language : "en");
    let clientLang = normalizeLang(rawParamLang);
    const clientExtra = queryParams.get("extra") || "";

    // App 自定义工单内容注入与优先级调度 (优先使用 App 传入的自定义配置)
    const customTitle = queryParams.get("title") || SERVER_CUSTOM_CONFIG.title || "";
    const customDesc = queryParams.get("desc") || SERVER_CUSTOM_CONFIG.desc || "";
    const customCategoriesParam = queryParams.get("categories") || SERVER_CUSTOM_CONFIG.categories || "";
    const customPlaceholder = queryParams.get("placeholder") || SERVER_CUSTOM_CONFIG.placeholder || "";

    // App 内嵌模式 (SDK 以 WebView 打开时附带 embed=1)：隐藏网页专属元素，并通过 JS Bridge 与原生通信
    const isEmbedded = queryParams.get("embed") === "1";

    function notifyNative(type, payload) {
      const message = JSON.stringify({ type, payload: payload || {} });
      try {
        if (window.webkit && window.webkit.messageHandlers && window.webkit.messageHandlers.feedbackHub) {
          window.webkit.messageHandlers.feedbackHub.postMessage(message); // iOS WKWebView
        } else if (window.FeedbackHubNative && window.FeedbackHubNative.postMessage) {
          window.FeedbackHubNative.postMessage(message); // Android WebView / Flutter webview_flutter
        } else if (window.parent && window.parent !== window) {
          window.parent.postMessage({ source: "feedback-hub", type, payload: payload || {} }, "*"); // Web iframe
        }
      } catch (e) {}
    }

    function closeEmbedded() {
      notifyNative("close");
    }

    let selectedCategory = "";
    let rateLimitTimer = null;
    let lastTicketPayload = null;

    document.addEventListener("DOMContentLoaded", () => {
      const selector = document.getElementById("lang-selector");
      if (selector) selector.value = clientLang;
      if (isEmbedded) {
        document.getElementById("sheet-handle").classList.add("hidden");
        document.getElementById("admin-link").classList.add("hidden");
        document.getElementById("btn-back").onclick = closeEmbedded;
      }
      initUI();
      checkRateLimit();
      initKeyboardShortcuts();
    });

    function switchLanguage(targetLang) {
      clientLang = normalizeLang(targetLang);
      document.documentElement.lang = clientLang === "zh" ? "zh-CN" : (clientLang === "zh-tw" ? "zh-TW" : clientLang);
      const selector = document.getElementById("lang-selector");
      if (selector) selector.value = clientLang;
      initUI();
      if (lastTicketPayload) {
        renderSuccessTicket(lastTicketPayload);
      }
      try {
        const u = new URL(window.location.href);
        u.searchParams.set("lang", clientLang);
        window.history.replaceState({}, "", u.toString());
      } catch (e) {}
    }

    function initKeyboardShortcuts() {
      document.addEventListener("keydown", (e) => {
        if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
          e.preventDefault();
          submitFeedback();
        }
      });
    }

    function initUI() {
      const config = APP_CONFIG[clientPkg] || APP_CONFIG["default"];
      const t = getI18n(clientLang);

      // 1. App 自定义标题：优先使用 App 传入的自定义标题，否则降级回退到产品配置多语言
      const displayTitle = customTitle.trim() || ((config.name && config.name[clientLang]) || (config.name && config.name["en"]) || config.name["zh"]);
      document.getElementById("app-title").textContent = displayTitle;

      // 2. App 自定义副标题：优先使用 App 传入的自定义副标题，否则降级回退到产品配置多语言
      const displayDesc = customDesc.trim() || ((config.desc && config.desc[clientLang]) || (config.desc && config.desc["en"]) || config.desc["zh"]);
      document.getElementById("app-desc").textContent = displayDesc;

      document.getElementById("badge-pkg").textContent = clientPkg;
      document.getElementById("label-live-status").textContent = t.liveStatusText;

      document.getElementById("label-category").innerHTML = t.categoryLabel + ' <span class="text-rose-500">*</span>';
      document.getElementById("category-hint").textContent = t.categoryHint;
      document.getElementById("label-content").innerHTML = t.contentLabel + ' <span class="text-rose-500">*</span>';

      // 3. App 自定义输入框提示：优先使用自定义 placeholder，否则使用当前语言默认占位符
      document.getElementById("content").placeholder = customPlaceholder.trim() || t.contentPlaceholder;
      document.getElementById("content-hint").textContent = t.contentHint;
      document.getElementById("label-clear").textContent = t.clearText;
      document.getElementById("label-email").textContent = t.emailLabel;
      document.getElementById("email").placeholder = t.emailPlaceholder;
      document.getElementById("management-notice").textContent = t.managementNotice;
      document.getElementById("submit-text").textContent = t.submitText;
      document.getElementById("success-title").textContent = t.successTitle;
      document.getElementById("success-desc").textContent = t.successDesc;
      document.getElementById("btn-back").textContent = isEmbedded ? t.btnDone : t.btnBack;
      document.getElementById("btn-copy-summary").textContent = t.btnCopySummary;

      // 动态更新凭据卡片上的多语言标签
      const statusBadge = document.getElementById("ticket-status-badge");
      if (statusBadge) statusBadge.textContent = t.statusBadgeText;
      const labelPkg = document.getElementById("ticket-label-pkg");
      if (labelPkg) labelPkg.textContent = t.pkgLabel;
      const labelCat = document.getElementById("ticket-label-cat");
      if (labelCat) labelCat.textContent = t.catLabel;
      const labelEmail = document.getElementById("ticket-label-email");
      if (labelEmail) labelEmail.textContent = t.emailMetaLabel;
      const labelTime = document.getElementById("ticket-label-time");
      if (labelTime) labelTime.textContent = t.timeLabel;
      const labelContent = document.getElementById("ticket-label-content");
      if (labelContent) labelContent.textContent = t.contentMetaLabel + ":";

      // 4. App 自定义分类列表：优先解析 App 传入的自定义分类（支持 JSON 数组、逗号分隔、竖线分隔）
      let categories = [];
      if (customCategoriesParam && customCategoriesParam.trim()) {
        const trimmed = customCategoriesParam.trim();
        try {
          if (trimmed.startsWith("[") && trimmed.endsWith("]")) {
            const parsed = JSON.parse(trimmed);
            if (Array.isArray(parsed) && parsed.length > 0) {
              categories = parsed.map(c => String(c).trim()).filter(Boolean);
            }
          }
        } catch (e) {}

        if (categories.length === 0) {
          const separator = trimmed.includes("|") ? "|" : ",";
          categories = trimmed.split(separator).map(c => c.trim()).filter(Boolean);
        }
      }

      // 若未传入自定义分类，平滑降级至产品预置多语言分类
      if (categories.length === 0) {
        categories = (config.categories && config.categories[clientLang]) || (config.categories && config.categories["en"]) || config.categories["zh"];
      }

      const categoryContainer = document.getElementById("category-group");
      categoryContainer.innerHTML = "";

      categories.forEach((catName, index) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "category-btn group relative min-w-0 flex items-center gap-2.5 px-3 py-2.5 sm:p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50/70 dark:bg-slate-900/40 text-left transition-all duration-150 cursor-pointer hover:border-slate-300 dark:hover:border-slate-700 active:scale-[0.98]";

        const iconSvg = getCategoryIconSvg(catName);
        btn.innerHTML = \`
          <div class="category-icon-box w-7 h-7 rounded-lg flex items-center justify-center bg-white dark:bg-slate-800 shadow-2xs shrink-0 transition-transform group-hover:scale-105">
            \${iconSvg}
          </div>
          <span class="category-name min-w-0 flex-1 text-sm font-medium leading-snug text-slate-700 dark:text-slate-300 break-words hyphens-auto">\${catName}</span>
          <div class="category-check hidden w-4 h-4 rounded-full bg-brand-600 text-white flex items-center justify-center shrink-0">
            <svg class="w-2.5 h-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="3">
              <path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />
            </svg>
          </div>
        \`;

        btn.onclick = () => selectCategory(catName, btn);
        categoryContainer.appendChild(btn);

        if (index === 0) {
          selectCategory(catName, btn);
        }
      });

      const contentEl = document.getElementById("content");
      const charCountEl = document.getElementById("char-count");
      const charProgressEl = document.getElementById("char-progress");
      const clearBtn = document.getElementById("btn-clear-content");

      contentEl.oninput = () => {
        const len = contentEl.value.length;
        charCountEl.textContent = \`\${len} / 1000\`;
        const percentage = Math.min(100, Math.round((len / 1000) * 100));
        charProgressEl.style.width = percentage + "%";

        if (len > 0) {
          clearBtn.classList.remove("hidden");
        } else {
          clearBtn.classList.add("hidden");
        }

        if (len >= 10 && len <= 900) {
          charCountEl.className = "text-xs font-mono text-brand-600 dark:text-brand-400 font-medium";
          charProgressEl.className = "h-full bg-brand-500 transition-all duration-150 rounded-full";
          document.getElementById("content-error").classList.add("hidden");
        } else if (len > 900 && len <= 1000) {
          charCountEl.className = "text-xs font-mono text-amber-500 font-medium";
          charProgressEl.className = "h-full bg-amber-500 transition-all duration-150 rounded-full";
          document.getElementById("content-error").classList.add("hidden");
        } else if (len > 1000) {
          charCountEl.className = "text-xs font-mono text-rose-500 font-medium";
          charProgressEl.className = "h-full bg-rose-500 transition-all duration-150 rounded-full";
        } else {
          charCountEl.className = "text-xs font-mono text-slate-400 dark:text-slate-500 font-medium";
          charProgressEl.className = "h-full bg-slate-300 dark:bg-slate-600 transition-all duration-150 rounded-full";
        }
      };

      const footerEl = document.getElementById("env-footer");
      footerEl.textContent = \`App: \${clientPkg} | v\${clientVer} | \${clientOs} | \${clientLang.toUpperCase()}\`;
    }

    function clearContent() {
      const contentEl = document.getElementById("content");
      contentEl.value = "";
      contentEl.dispatchEvent(new Event("input"));
      contentEl.focus();
    }

    function selectCategory(catName, activeBtn) {
      selectedCategory = catName;
      document.querySelectorAll(".category-btn").forEach(btn => {
        btn.classList.remove("border-brand-500", "ring-2", "ring-brand-500/20", "bg-brand-50/70", "dark:bg-brand-950/40", "dark:border-brand-500");
        btn.classList.add("border-slate-200", "dark:border-slate-800", "bg-slate-50/70", "dark:bg-slate-900/40");
        const check = btn.querySelector(".category-check");
        if (check) check.classList.add("hidden");
      });

      activeBtn.classList.remove("border-slate-200", "dark:border-slate-800", "bg-slate-50/70", "dark:bg-slate-900/40");
      activeBtn.classList.add("border-brand-500", "ring-2", "ring-brand-500/20", "bg-brand-50/70", "dark:bg-brand-950/40", "dark:border-brand-500");
      const activeCheck = activeBtn.querySelector(".category-check");
      if (activeCheck) activeCheck.classList.remove("hidden");

      document.getElementById("category-error").classList.add("hidden");
    }

    function checkRateLimit() {
      const lastSubmit = parseInt(localStorage.getItem("feedback_last_submit_time") || "0", 10);
      const now = Date.now();
      const elapsed = Math.floor((now - lastSubmit) / 1000);
      const cooldown = 60;

      if (elapsed < cooldown) {
        startCooldown(cooldown - elapsed);
      }
    }

    function startCooldown(remainingSeconds) {
      const btn = document.getElementById("btn-submit");
      const btnText = document.getElementById("submit-text");
      const t = I18N[clientLang];

      btn.disabled = true;
      let count = remainingSeconds;
      if (rateLimitTimer) clearInterval(rateLimitTimer);

      btnText.textContent = t.rateLimitText.replace("{sec}", count);
      rateLimitTimer = setInterval(() => {
        count -= 1;
        if (count <= 0) {
          clearInterval(rateLimitTimer);
          btn.disabled = false;
          btnText.textContent = t.submitText;
        } else {
          btnText.textContent = t.rateLimitText.replace("{sec}", count);
        }
      }, 1000);
    }

    async function submitFeedback() {
      const t = getI18n(clientLang);
      const content = document.getElementById("content").value.trim();
      const email = document.getElementById("email").value.trim();
      const honeypot = document.getElementById("website_url").value;

      let hasError = false;
      if (!selectedCategory) {
        const catErr = document.getElementById("category-error");
        catErr.textContent = t.selectCategoryError;
        catErr.classList.remove("hidden");
        hasError = true;
      }

      if (content.length < 10 || content.length > 1000) {
        const contentErr = document.getElementById("content-error");
        contentErr.textContent = t.contentLengthError;
        contentErr.classList.remove("hidden");
        hasError = true;
      }

      if (hasError) return;

      const btn = document.getElementById("btn-submit");
      const spinner = document.getElementById("submit-spinner");
      const btnText = document.getElementById("submit-text");
      btn.disabled = true;
      spinner.classList.remove("hidden");
      btnText.textContent = t.submittingText;

      const payload = {
        category: selectedCategory,
        content: content,
        email: email,
        pkg: clientPkg,
        ver: clientVer,
        os: clientOs,
        lang: clientLang,
        extra: clientExtra,
        website_url: honeypot
      };

      try {
        const res = await fetch("/api/submit", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload)
        });

        const result = await res.json();

        if (res.ok && result.success) {
          localStorage.setItem("feedback_last_submit_time", Date.now().toString());
          renderSuccessTicket({
            ticketId: result.data?.ticket_id || ("T-" + Date.now().toString(36).toUpperCase()),
            category: selectedCategory,
            email: email || t.anonymous,
            content: content,
            time: result.data?.time || new Date().toLocaleString()
          });
          startCooldown(60);
        } else {
          alert(result.error || "Submission failed. Please try again.");
          btn.disabled = false;
          btnText.textContent = t.submitText;
        }
      } catch (err) {
        console.error(err);
        alert("Network error, please check your connection.");
        btn.disabled = false;
        btnText.textContent = t.submitText;
      } finally {
        spinner.classList.add("hidden");
      }
    }

    function renderSuccessTicket({ ticketId, category, email, content, time }) {
      lastTicketPayload = { ticketId, category, email, content, time, pkg: clientPkg };
      notifyNative("submitted", { ticketId, category });
      document.getElementById("form-card").classList.add("hidden");
      const successCard = document.getElementById("success-card");
      successCard.classList.remove("hidden");

      document.getElementById("ticket-id-display").textContent = ticketId;
      document.getElementById("ticket-pkg-display").textContent = clientPkg;
      document.getElementById("ticket-cat-display").textContent = category;
      document.getElementById("ticket-email-display").textContent = email;
      document.getElementById("ticket-time-display").textContent = time;
      document.getElementById("ticket-content-display").textContent = content;
    }

    // 兼容 App 内 WebView：navigator.clipboard 不可用或被拒时回退到 execCommand
    function copyText(text) {
      const fallback = () => new Promise((resolve, reject) => {
        const ta = document.createElement("textarea");
        ta.value = text;
        ta.setAttribute("readonly", "");
        ta.style.position = "fixed";
        ta.style.opacity = "0";
        document.body.appendChild(ta);
        ta.select();
        const ok = document.execCommand("copy");
        document.body.removeChild(ta);
        ok ? resolve() : reject(new Error("copy failed"));
      });
      if (navigator.clipboard && navigator.clipboard.writeText) {
        return navigator.clipboard.writeText(text).catch(fallback);
      }
      return fallback();
    }

    function copyTicketId() {
      const t = getI18n(clientLang);
      const idText = document.getElementById("ticket-id-display").textContent;
      copyText(idText).then(() => {
        const copyTextEl = document.getElementById("copy-text");
        const copyIconEl = document.getElementById("copy-icon");

        copyTextEl.textContent = t.copied;
        copyTextEl.classList.add("text-emerald-600", "dark:text-emerald-400");
        copyIconEl.innerHTML = '<path stroke-linecap="round" stroke-linejoin="round" d="M5 13l4 4L19 7" />';
        copyIconEl.classList.remove("text-slate-500");
        copyIconEl.classList.add("text-emerald-500");

        setTimeout(() => {
          copyTextEl.textContent = t.copyId;
          copyTextEl.classList.remove("text-emerald-600", "dark:text-emerald-400");
          copyIconEl.innerHTML = '<rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>';
          copyIconEl.classList.remove("text-emerald-500");
          copyIconEl.classList.add("text-slate-500");
        }, 1800);
      });
    }

    function copySummary() {
      const t = getI18n(clientLang);
      if (!lastTicketPayload) return;
      const summaryText = "[" + t.successTitle + "]\\n" + t.ticketIdLabel + ": " + lastTicketPayload.ticketId + "\\n" + t.pkgLabel + ": " + lastTicketPayload.pkg + "\\n" + t.catLabel + ": " + lastTicketPayload.category + "\\n" + t.emailMetaLabel + ": " + lastTicketPayload.email + "\\n" + t.timeLabel + ": " + lastTicketPayload.time + "\\n" + t.contentMetaLabel + ":\\n" + lastTicketPayload.content;
      copyText(summaryText).then(() => {
        const summaryBtn = document.getElementById("btn-copy-summary");
        const originText = summaryBtn.textContent;
        summaryBtn.textContent = "✓ " + t.copied;
        summaryBtn.classList.add("text-emerald-600", "dark:text-emerald-400");
        setTimeout(() => {
          summaryBtn.textContent = originText;
          summaryBtn.classList.remove("text-emerald-600", "dark:text-emerald-400");
        }, 1800);
      });
    }

    function resetForm() {
      document.getElementById("content").value = "";
      document.getElementById("email").value = "";
      document.getElementById("char-count").textContent = "0 / 1000";
      document.getElementById("char-progress").style.width = "0%";
      document.getElementById("btn-clear-content").classList.add("hidden");
      document.getElementById("form-card").classList.remove("hidden");
      document.getElementById("success-card").classList.add("hidden");
      checkRateLimit();
    }
  </script>
</body>
</html>`;
}

/**
 * 前端“在线多维工单表格”页面模板（GET /sheet）
 */
function renderSheetHTML({ sheetViewUrl }) {
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>在线工单表格看板 - Feedback Hub</title>
  <script src="https://cdn.tailwindcss.com"></script>
  <script>
    tailwind.config = {
      darkMode: 'media',
      theme: {
        extend: {
          colors: {
            brand: {
              50: '#eff6ff',
              100: '#dbeafe',
              500: '#3b82f6',
              600: '#2563eb',
              700: '#1d4ed8',
            }
          }
        }
      }
    }
  </script>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    .scrollbar-thin::-webkit-scrollbar {
      height: 6px;
      width: 6px;
    }
    .scrollbar-thin::-webkit-scrollbar-thumb {
      background: #cbd5e1;
      border-radius: 4px;
    }
    .dark .scrollbar-thin::-webkit-scrollbar-thumb {
      background: #475569;
    }
  </style>
</head>
<body class="bg-slate-50 dark:bg-slate-900 text-slate-800 dark:text-slate-100 min-h-screen flex flex-col antialiased">

  <!-- 顶部导航 -->
  <header class="border-b border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-800/80 backdrop-blur px-4 sm:px-8 py-3.5 sticky top-0 z-20">
    <div class="max-w-7xl mx-auto flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-3">
        <div class="w-8 h-8 rounded-xl bg-brand-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
          📊
        </div>
        <div>
          <h1 class="text-base font-bold text-slate-900 dark:text-white">在线工单表格看板</h1>
          <p class="text-xs text-slate-400">实时聚合所有产品的用户反馈数据</p>
        </div>
      </div>

      <div class="flex items-center gap-2.5">
        <a
          href="/"
          class="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
        >
          ← 反馈表单页
        </a>
        <a
          href="${sheetViewUrl}"
          target="_blank"
          rel="noopener noreferrer"
          class="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition shadow-sm flex items-center gap-1.5"
        >
          <span>在 Google Sheets 中打开</span>
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
          </svg>
        </a>
        <button
          onclick="exportCSV()"
          class="px-3.5 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 text-xs font-medium text-slate-600 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-700 transition"
        >
          导出 CSV
        </button>
      </div>
    </div>
  </header>

  <!-- 筛选与搜索工具条 -->
  <div class="max-w-7xl mx-auto w-full px-4 sm:px-8 pt-6 pb-4">
    <div class="flex flex-wrap items-center justify-between gap-3 bg-white dark:bg-slate-800 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm">
      <div class="flex flex-wrap items-center gap-3 flex-1 min-w-[280px]">
        <!-- 搜索框 -->
        <div class="relative flex-1 min-w-[200px]">
          <svg class="w-4 h-4 text-slate-400 absolute left-3 top-2.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
          <input
            type="text"
            id="search-input"
            oninput="renderTable()"
            placeholder="搜索摘要、原话或邮箱..."
            class="w-full pl-9 pr-3 py-1.5 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-800 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>

        <!-- 产品筛选 -->
        <select
          id="filter-pkg"
          onchange="renderTable()"
          class="py-1.5 px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="ALL">全部产品</option>
        </select>

        <!-- 严重程度筛选 -->
        <select
          id="filter-severity"
          onchange="renderTable()"
          class="py-1.5 px-3 rounded-xl bg-slate-50 dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-brand-500"
        >
          <option value="ALL">全部严重级别</option>
          <option value="HIGH">HIGH (紧急崩溃)</option>
          <option value="MEDIUM">MEDIUM (一般问题)</option>
          <option value="LOW">LOW (建议反馈)</option>
        </select>
      </div>

      <div class="text-xs text-slate-400 font-mono">
        共 <span id="record-count" class="font-bold text-slate-700 dark:text-slate-200">0</span> 条工单
      </div>
    </div>
  </div>

  <!-- 在线多维表格容器 -->
  <main class="max-w-7xl mx-auto w-full px-4 sm:px-8 pb-10 flex-1 flex flex-col">
    <div class="bg-white dark:bg-slate-800 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-sm overflow-hidden flex-1 flex flex-col">
      <div class="overflow-x-auto scrollbar-thin flex-1">
        <table class="w-full text-left text-xs whitespace-nowrap">
          <thead class="bg-slate-50/80 dark:bg-slate-900/60 border-b border-slate-200 dark:border-slate-700 text-slate-500 dark:text-slate-400 font-semibold select-none">
            <tr>
              <th class="py-3 px-4">时间</th>
              <th class="py-3 px-4">产品 (pkg)</th>
              <th class="py-3 px-4">分类</th>
              <th class="py-3 px-4">严重度</th>
              <th class="py-3 px-4 min-w-[200px]">AI 核心摘要</th>
              <th class="py-3 px-4 min-w-[300px]">用户原始反馈</th>
              <th class="py-3 px-4">联系邮箱</th>
              <th class="py-3 px-4">版本</th>
              <th class="py-3 px-4">系统环境</th>
              <th class="py-3 px-4">状态</th>
            </tr>
          </thead>
          <tbody id="table-body" class="divide-y divide-slate-100 dark:divide-slate-700/60 font-normal">
            <!-- 动态渲染行 -->
          </tbody>
        </table>
      </div>
    </div>
  </main>

  <script>
    let allTickets = [];

    async function loadTickets() {
      try {
        const res = await fetch("/api/tickets");
        const json = await res.json();
        if (json.success && Array.isArray(json.data)) {
          allTickets = json.data;
          initFilters();
          renderTable();
        }
      } catch (e) {
        console.error("Failed to load tickets:", e);
      }
    }

    function initFilters() {
      const pkgSelect = document.getElementById("filter-pkg");
      const pkgs = Array.from(new Set(allTickets.map(t => t.pkg))).filter(Boolean);
      pkgSelect.innerHTML = '<option value="ALL">全部产品</option>';
      pkgs.forEach(pkg => {
        const opt = document.createElement("option");
        opt.value = pkg;
        opt.textContent = pkg;
        pkgSelect.appendChild(opt);
      });
    }

    function renderTable() {
      const query = document.getElementById("search-input").value.trim().toLowerCase();
      const filterPkg = document.getElementById("filter-pkg").value;
      const filterSeverity = document.getElementById("filter-severity").value;

      const filtered = allTickets.filter(t => {
        if (filterPkg !== "ALL" && t.pkg !== filterPkg) return false;
        if (filterSeverity !== "ALL" && (t.severity || "").toUpperCase() !== filterSeverity) return false;
        if (query) {
          const matchStr = \`\${t.summary} \${t.content} \${t.email} \${t.pkg}\`.toLowerCase();
          if (!matchStr.includes(query)) return false;
        }
        return true;
      });

      document.getElementById("record-count").textContent = filtered.length;
      const tbody = document.getElementById("table-body");
      tbody.innerHTML = "";

      if (filtered.length === 0) {
        tbody.innerHTML = '<tr><td colspan="10" class="py-8 text-center text-slate-400">暂无匹配的工单记录</td></tr>';
        return;
      }

      filtered.forEach(t => {
        const tr = document.createElement("tr");
        tr.className = "hover:bg-slate-50/80 dark:hover:bg-slate-700/40 transition";

        const sev = (t.severity || "LOW").toUpperCase();
        const sevBadge = sev === "HIGH"
          ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-rose-50 text-rose-600 dark:bg-rose-950/60 dark:text-rose-300 border border-rose-200 dark:border-rose-900">HIGH</span>'
          : sev === "MEDIUM"
          ? '<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-amber-50 text-amber-600 dark:bg-amber-950/60 dark:text-amber-300 border border-amber-200 dark:border-amber-900">MEDIUM</span>'
          : '<span class="px-2 py-0.5 rounded-full text-[11px] font-semibold bg-slate-100 text-slate-600 dark:bg-slate-700 dark:text-slate-300">LOW</span>';

        tr.innerHTML = \`
          <td class="py-3 px-4 text-slate-400 font-mono text-[11px]">\${t.time}</td>
          <td class="py-3 px-4 font-semibold text-slate-800 dark:text-slate-200">\${t.pkg}</td>
          <td class="py-3 px-4 text-slate-600 dark:text-slate-300">\${t.category}</td>
          <td class="py-3 px-4">\${sevBadge}</td>
          <td class="py-3 px-4 font-medium text-slate-900 dark:text-white max-w-[240px] truncate" title="\${t.summary}">\${t.summary}</td>
          <td class="py-3 px-4 text-slate-500 dark:text-slate-400 max-w-[360px] truncate" title="\${t.content}">\${t.content}</td>
          <td class="py-3 px-4 text-slate-400 font-mono text-[11px]">\${t.email || "-"}</td>
          <td class="py-3 px-4 text-slate-400 font-mono text-[11px]">v\${t.ver}</td>
          <td class="py-3 px-4 text-slate-400 text-[11px] max-w-[160px] truncate" title="\${t.os}">\${t.os}</td>
          <td class="py-3 px-4">
            <span class="inline-flex items-center gap-1 text-[11px] text-emerald-600 dark:text-emerald-400 font-medium">
              <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>\${t.status || "待处理"}
            </span>
          </td>
        \`;
        tbody.appendChild(tr);
      });
    }

    function exportCSV() {
      if (allTickets.length === 0) {
        alert("暂无可导出的工单数据");
        return;
      }
      const headers = ["工单时间", "产品标识", "分类", "严重级别", "AI核心摘要", "用户原始反馈", "中文翻译", "联系邮箱", "版本号", "运行系统", "处理状态"];
      const rows = allTickets.map(t => [
        t.time, t.pkg, t.category, t.severity,
        \`"\${(t.summary || "").replace(/"/g, '""')}"\`,
        \`"\${(t.content || "").replace(/"/g, '""')}"\`,
        \`"\${(t.translation || "").replace(/"/g, '""')}"\`,
        t.email, t.ver, \`"\${(t.os || "").replace(/"/g, '""')}"\`, t.status
      ]);

      const csvContent = "\\uFEFF" + [headers.join(","), ...rows.map(r => r.join(","))].join("\\n");
      const blob = new Blob([csvContent], { type: "text/csv;charset=utf-8;" });
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download = \`feedback_tickets_\${new Date().toISOString().slice(0, 10)}.csv\`;
      a.click();
    }

    document.addEventListener("DOMContentLoaded", loadTickets);
  </script>
</body>
</html>`;
}

// 导出内部模块方便测试
export {
  handleGetHome,
  handleGetSheet,
  handleFeedbackSubmit,
  resolveTargetRepo,
  analyzeWithGemini,
  createGitHubIssue,
  appendRowToTencentSheet,
  syncToOnlineSheets,
  determineFallbackSeverity,
  mapFallbackCategory,
  renderHTML,
  renderSheetHTML,
  DEFAULT_REPO_MAP,
  DEFAULT_SHEET_CONFIG,
  DEFAULT_TENCENT_CONFIG
};

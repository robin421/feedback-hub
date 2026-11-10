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
  const sheetViewUrl = (env && (env.GOOGLE_SHEET_VIEW_URL || env.TENCENT_DOCS_VIEW_URL)) || DEFAULT_SHEET_CONFIG.viewUrl;

  const html = renderHTML({ pkg, ver, os, lang, extra, sheetViewUrl });

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
 * 前端 HTML 页面模板渲染（移动端 + 桌面端自适应）
 */
function renderHTML({ pkg, ver, os, lang, extra, sheetViewUrl }) {
  return `<!DOCTYPE html>
<html lang="${lang === "zh" ? "zh-CN" : "en"}">
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
      -webkit-tap-highlight-color: transparent;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    }
    textarea, input {
      font-size: 16px !important;
    }
  </style>
</head>
<body class="bg-slate-50 text-slate-800 dark:bg-slate-900 dark:text-slate-100 min-h-screen flex flex-col justify-between antialiased transition-colors duration-200">

  <!-- 顶部导航条（桌面端与移动端兼顾） -->
  <header class="w-full border-b border-slate-200/80 dark:border-slate-800 bg-white/70 dark:bg-slate-900/70 backdrop-blur-md sticky top-0 z-10 px-4 sm:px-8 py-3">
    <div class="max-w-5xl mx-auto flex items-center justify-between">
      <div class="flex items-center gap-2.5">
        <div class="w-7 h-7 rounded-lg bg-brand-600 text-white flex items-center justify-center font-bold text-sm shadow-sm">
          F
        </div>
        <span class="font-bold text-sm tracking-tight text-slate-900 dark:text-white">Feedback Hub</span>
        <span id="badge-pkg" class="px-2 py-0.5 rounded-full text-xs font-medium bg-blue-50 text-blue-600 dark:bg-blue-950/60 dark:text-blue-300 border border-blue-100 dark:border-blue-900">
          ${pkg}
        </span>
      </div>
      
      <!-- 右侧：简洁状态提示（绝不向普通终端用户暴露后台表格） -->
      <div class="flex items-center gap-2">
        <span class="inline-flex items-center gap-1.5 px-2.5 py-1 text-xs font-medium rounded-full text-slate-500 dark:text-slate-400 bg-slate-100 dark:bg-slate-800">
          <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>
          <span>技术支持在线</span>
        </span>
      </div>
    </div>
  </header>

  <!-- 主容器：桌面端双栏 Split，移动端流式单列 -->
  <main class="w-full max-w-5xl mx-auto p-4 sm:p-6 lg:p-8 flex-1 flex flex-col justify-center">
    
    <!-- 反馈主卡片 -->
    <div id="form-card" class="bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 p-5 sm:p-8 lg:p-10 transition-all">
      
      <div class="lg:grid lg:grid-cols-12 lg:gap-10">
        
        <!-- 左侧专栏 (桌面端占 5 列，移动端置顶) -->
        <div class="lg:col-span-5 flex flex-col justify-between mb-8 lg:mb-0 lg:border-r lg:border-slate-100 dark:lg:border-slate-700/60 lg:pr-8">
          <div>
            <div class="inline-flex p-3 rounded-2xl bg-brand-50 dark:bg-brand-950/50 text-brand-600 dark:text-brand-400 mb-4 shadow-sm">
              <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.863 9.863 0 01-4.255-.949L3 20l1.395-3.72C3.512 15.042 3 13.574 3 12c0-4.418 4.03-8 9-8s9 3.582 9 8z" />
              </svg>
            </div>
            
            <h1 id="app-title" class="text-2xl font-bold tracking-tight text-slate-900 dark:text-white mb-2">
              <!-- 动态标题 -->
            </h1>
            <p id="app-desc" class="text-sm text-slate-500 dark:text-slate-400 leading-relaxed mb-6">
              <!-- 动态副标题 -->
            </p>

            <!-- 去客服化预期管理卡片 -->
            <div class="p-4 rounded-2xl bg-amber-50/80 dark:bg-amber-950/30 border border-amber-200/70 dark:border-amber-900/40 text-amber-900 dark:text-amber-200/90 text-xs leading-relaxed flex items-start gap-2.5 mb-6">
              <svg class="w-4 h-4 mt-0.5 flex-shrink-0 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span id="management-notice">
                <!-- 动态文案 -->
              </span>
            </div>
          </div>

          <!-- 桌面端快捷键与说明 -->
          <div class="hidden lg:block pt-6 border-t border-slate-100 dark:border-slate-700/60 text-xs text-slate-400 dark:text-slate-500 space-y-2">
            <div class="flex items-center gap-2">
              <kbd class="px-2 py-1 bg-slate-100 dark:bg-slate-700 rounded font-mono text-[11px] text-slate-600 dark:text-slate-300">⌘ + Enter</kbd>
              <span>或 Ctrl + Enter 快捷提交工单</span>
            </div>
            <div class="flex items-center gap-2">
              <span class="inline-block w-2 h-2 rounded-full bg-emerald-500"></span>
              <span>数据直连在线表格，实时归档</span>
            </div>
          </div>

        </div>

        <!-- 右侧表单专区 (桌面端占 7 列) -->
        <div class="lg:col-span-7">
          <form id="feedback-form" onsubmit="return false;" novalidate>
            
            <input type="text" name="website_url" id="website_url" value="" autocomplete="off" style="position: absolute; left: -9999px; opacity: 0; pointer-events: none;" tabindex="-1" aria-hidden="true" />

            <!-- 1. 问题分类（胶囊单选组） -->
            <div class="mb-5">
              <label class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-2.5" id="label-category">
                问题分类 <span class="text-rose-500">*</span>
              </label>
              <div id="category-group" class="grid grid-cols-2 gap-2.5">
                <!-- 动态单选按钮 -->
              </div>
              <p id="category-error" class="hidden text-xs text-rose-500 mt-1.5"></p>
            </div>

            <!-- 2. 详细描述 (textarea, 10-1000字) -->
            <div class="mb-5">
              <div class="flex justify-between items-center mb-1.5">
                <label for="content" class="text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400" id="label-content">
                  详细描述 <span class="text-rose-500">*</span>
                </label>
                <span id="char-count" class="text-xs font-mono text-slate-400 dark:text-slate-500">0 / 1000</span>
              </div>
              <textarea
                id="content"
                name="content"
                rows="6"
                maxlength="1000"
                class="w-full px-4 py-3 rounded-2xl border border-slate-300 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-900/50 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all resize-none leading-relaxed text-sm"
                placeholder=""
              ></textarea>
              <div class="flex justify-between items-center mt-1.5">
                <p id="content-hint" class="text-xs text-slate-400 dark:text-slate-500"></p>
                <p id="content-error" class="hidden text-xs text-rose-500"></p>
              </div>
            </div>

            <!-- 3. 联系邮箱 (选填) -->
            <div class="mb-6">
              <label for="email" class="block text-xs font-semibold uppercase tracking-wider text-slate-500 dark:text-slate-400 mb-1.5" id="label-email">
                联系邮箱 (选填)
              </label>
              <input
                type="email"
                id="email"
                name="email"
                class="w-full px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-600 bg-slate-50/50 dark:bg-slate-900/50 text-slate-900 dark:text-slate-100 placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-brand-500 focus:border-transparent transition-all text-sm"
                placeholder=""
              />
            </div>

            <!-- 提交按钮 -->
            <button
              type="button"
              id="btn-submit"
              onclick="submitFeedback()"
              class="w-full py-3.5 px-6 rounded-2xl font-semibold text-sm text-white bg-brand-600 hover:bg-brand-700 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-brand-500 focus:ring-offset-2 disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100 transition-all shadow-sm flex items-center justify-center gap-2"
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

    <!-- 提交成功状态卡片：仅向普通用户回显其自身刚提交的工单凭据与内容，绝不泄露管理表格 -->
    <div id="success-card" class="hidden bg-white dark:bg-slate-800 rounded-3xl shadow-sm border border-slate-200 dark:border-slate-700 p-6 sm:p-10 text-left transition-all animate-fade-in max-w-xl mx-auto w-full">
      <div class="text-center mb-6">
        <div class="w-14 h-14 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 rounded-2xl flex items-center justify-center mx-auto mb-3.5 shadow-sm">
          <svg class="w-7 h-7" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2.5" d="M5 13l4 4L19 7"></path>
          </svg>
        </div>
        <h2 id="success-title" class="text-xl font-bold text-slate-900 dark:text-white mb-1.5">工单已成功提交</h2>
        <p id="success-desc" class="text-xs text-slate-500 dark:text-slate-400 leading-relaxed max-w-md mx-auto">我们已完整记录您的工单内容。研发团队将进行评估分析，如需补充信息将通过邮箱联系您。</p>
      </div>

      <!-- 用户工单凭据回显区 -->
      <div class="p-4 sm:p-5 bg-slate-50 dark:bg-slate-900/60 rounded-2xl border border-slate-200/80 dark:border-slate-800 text-xs text-slate-600 dark:text-slate-300 space-y-2.5 mb-6">
        <div class="flex justify-between items-center border-b border-slate-200/60 dark:border-slate-800/80 pb-2">
          <span class="text-slate-400 dark:text-slate-500">工单编号:</span>
          <span id="ticket-id-display" class="font-mono font-bold text-brand-600 dark:text-brand-400">T-Pending</span>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-slate-400 dark:text-slate-500">所属产品:</span>
          <span id="ticket-pkg-display" class="font-medium text-slate-800 dark:text-slate-200">${pkg}</span>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-slate-400 dark:text-slate-500">问题分类:</span>
          <span id="ticket-cat-display" class="font-medium text-slate-800 dark:text-slate-200"></span>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-slate-400 dark:text-slate-500">联系邮箱:</span>
          <span id="ticket-email-display" class="font-mono text-slate-800 dark:text-slate-200">未提供</span>
        </div>
        <div class="flex justify-between items-center">
          <span class="text-slate-400 dark:text-slate-500">当前状态:</span>
          <span class="font-medium text-emerald-600 dark:text-emerald-400 flex items-center gap-1.5">
            <span class="w-1.5 h-1.5 rounded-full bg-emerald-500"></span>已入库排期评估
          </span>
        </div>
        <!-- 提交内容回显 -->
        <div class="pt-2.5 border-t border-slate-200/60 dark:border-slate-800/80">
          <span class="block text-slate-400 dark:text-slate-500 mb-1.5 font-semibold">您提交的详细内容:</span>
          <div id="ticket-content-display" class="p-3 bg-white dark:bg-slate-800/80 rounded-xl border border-slate-200/60 dark:border-slate-700/60 text-slate-700 dark:text-slate-300 whitespace-pre-wrap leading-relaxed max-h-40 overflow-y-auto font-sans text-xs"></div>
        </div>
      </div>

      <div class="flex gap-3">
        <button
          type="button"
          onclick="resetForm()"
          class="w-full py-3.5 px-4 rounded-xl text-xs font-semibold text-white bg-brand-600 hover:bg-brand-700 active:scale-[0.99] transition shadow-sm text-center"
          id="btn-back"
        >
          返回 / 再次提交反馈
        </button>
      </div>
    </div>

    <!-- 底部环境参数小字展示 -->
    <footer class="mt-6 text-center">
      <div id="env-footer" class="text-xs font-mono text-slate-400 dark:text-slate-500 leading-relaxed select-none">
        <!-- 自动渲染环境参数 -->
      </div>
      <div class="mt-2 text-[11px] text-slate-400/60 dark:text-slate-600">
        Feedback Hub · 独立产品支持中心 · <a href="/sheet" class="hover:underline">管理视图</a>
      </div>
    </footer>

  </main>

  <script>
    const APP_CONFIG = {
      "default": {
        name: { zh: "用户问题与建议反馈", en: "Feedback Center" },
        desc: { zh: "感谢您的宝贵意见，我们专注于以代码改进体验，所有工单自动沉淀至团队在线表格", en: "Help us improve product experience. Tickets are synced directly to our online spreadsheet." },
        categories: {
          zh: ["程序报错/闪退", "功能不好用", "新功能建议", "其他问题"],
          en: ["Bug / Crash", "Usability", "Feature Request", "Other"]
        }
      },
      "aisubdeal": {
        name: { zh: "AiSubDeal 订阅比价助手", en: "AiSubDeal Feedback" },
        desc: { zh: "价格追踪、汇率换算与各平台订阅信息反馈", en: "Feedback for price tracking and subscriptions" },
        categories: {
          zh: ["价格不准", "汇率问题", "功能建议", "其他"],
          en: ["Price Inaccurate", "Currency Issue", "Feature Request", "Other"]
        }
      },
      "fitflow": {
        name: { zh: "FitFlow 健身计划", en: "FitFlow Feedback" },
        desc: { zh: "动作库、周期记录与训练数据同步反馈", en: "Workout tracking and routine feedback" },
        categories: {
          zh: ["数据同步失败", "动作库建议", "界面优化", "其他"],
          en: ["Sync Failed", "Exercise Request", "UI Improvement", "Other"]
        }
      }
    };

    const I18N = {
      zh: {
        categoryLabel: "问题分类",
        contentLabel: "详细描述",
        contentPlaceholder: "请详细描述您遇到的问题现象、复现步骤或期望，帮助我们准确定位（10~1000字）...",
        contentHint: "至少输入 10 个字符",
        emailLabel: "联系邮箱 (选填)",
        emailPlaceholder: "选填：仅在修复重大问题或需要补充信息时通知您",
        submitText: "提交反馈",
        submittingText: "提交中...",
        rateLimitText: "请稍候 {sec}s 后再提交",
        managementNotice: "感谢反馈！作为独立开发团队，我们会将全部精力用于代码修复，每一条工单都会直接进入在线表格队列，通常不会进行人工一对一回复。",
        successTitle: "反馈已送达在线表格",
        successDesc: "您的意见已直接进入我们的迭代看板。感谢您对我们产品的关注与支持！",
        btnBack: "再次提交反馈",
        selectCategoryError: "请选择一个问题分类",
        contentLengthError: "内容长度需在 10 至 1000 字之间"
      },
      en: {
        categoryLabel: "Category",
        contentLabel: "Detailed Description",
        contentPlaceholder: "Please describe what happened, steps to reproduce, or suggestions (10-1000 chars)...",
        contentHint: "At least 10 characters required",
        emailLabel: "Contact Email (Optional)",
        emailPlaceholder: "Optional: Only for critical updates or clarifications",
        submitText: "Submit Ticket",
        submittingText: "Submitting...",
        rateLimitText: "Please wait {sec}s before next submit",
        managementNotice: "Thank you! As an indie team, our focus is on fixing bugs in code. Every ticket is logged into our spreadsheet, and we typically do not reply 1-on-1.",
        successTitle: "Ticket Recorded in Spreadsheet!",
        successDesc: "Your feedback has been routed directly to our engineering backlog. Thanks for helping us improve!",
        btnBack: "Submit Another",
        selectCategoryError: "Please choose a category",
        contentLengthError: "Description must be between 10 and 1000 characters"
      }
    };

    const queryParams = new URLSearchParams(window.location.search);
    const clientPkg = queryParams.get("pkg") || "default";
    const clientVer = queryParams.get("ver") || "1.0.0";
    const clientOs = queryParams.get("os") || (navigator.userAgent.includes("Android") ? "Android" : navigator.userAgent.includes("iPhone") ? "iOS" : "Desktop Browser");
    const paramLang = (queryParams.get("lang") || "").toLowerCase();
    const clientLang = (paramLang === "zh" || (!paramLang && (navigator.language || "").startsWith("zh"))) ? "zh" : "en";
    const clientExtra = queryParams.get("extra") || "";

    let selectedCategory = "";
    let rateLimitTimer = null;

    document.addEventListener("DOMContentLoaded", () => {
      initUI();
      checkRateLimit();
      initKeyboardShortcuts();
    });

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
      const t = I18N[clientLang];

      document.getElementById("app-title").textContent = config.name[clientLang] || config.name["en"];
      document.getElementById("app-desc").textContent = config.desc[clientLang] || config.desc["en"];
      document.getElementById("badge-pkg").textContent = clientPkg;

      document.getElementById("label-category").innerHTML = t.categoryLabel + ' <span class="text-rose-500">*</span>';
      document.getElementById("label-content").innerHTML = t.contentLabel + ' <span class="text-rose-500">*</span>';
      document.getElementById("content").placeholder = t.contentPlaceholder;
      document.getElementById("content-hint").textContent = t.contentHint;
      document.getElementById("label-email").textContent = t.emailLabel;
      document.getElementById("email").placeholder = t.emailPlaceholder;
      document.getElementById("management-notice").textContent = t.managementNotice;
      document.getElementById("submit-text").textContent = t.submitText;
      document.getElementById("success-title").textContent = t.successTitle;
      document.getElementById("success-desc").textContent = t.successDesc;
      document.getElementById("btn-back").textContent = t.btnBack;

      const categories = config.categories[clientLang] || config.categories["en"];
      const categoryContainer = document.getElementById("category-group");
      categoryContainer.innerHTML = "";

      categories.forEach((catName, index) => {
        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "category-btn py-2.5 px-3.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-900/40 text-xs font-medium text-slate-700 dark:text-slate-300 hover:border-brand-500/50 hover:bg-white dark:hover:bg-slate-800 transition text-center truncate shadow-sm";
        btn.textContent = catName;
        btn.onclick = () => selectCategory(catName, btn);
        categoryContainer.appendChild(btn);

        if (index === 0) {
          selectCategory(catName, btn);
        }
      });

      const contentEl = document.getElementById("content");
      const charCountEl = document.getElementById("char-count");
      contentEl.addEventListener("input", () => {
        const len = contentEl.value.length;
        charCountEl.textContent = \`\${len} / 1000\`;
        if (len >= 10 && len <= 1000) {
          charCountEl.className = "text-xs font-mono text-brand-600 dark:text-brand-400";
          document.getElementById("content-error").classList.add("hidden");
        } else if (len > 1000) {
          charCountEl.className = "text-xs font-mono text-rose-500";
        } else {
          charCountEl.className = "text-xs font-mono text-slate-400 dark:text-slate-500";
        }
      });

      const footerEl = document.getElementById("env-footer");
      footerEl.textContent = \`App: \${clientPkg} | v\${clientVer} | \${clientOs} | \${clientLang.toUpperCase()}\`;
    }

    function selectCategory(catName, activeBtn) {
      selectedCategory = catName;
      document.querySelectorAll(".category-btn").forEach(btn => {
        btn.classList.remove("border-brand-600", "bg-brand-50", "text-brand-700", "dark:border-brand-500", "dark:bg-brand-950/40", "dark:text-brand-300", "font-semibold");
        btn.classList.add("border-slate-200", "dark:border-slate-700", "bg-slate-50", "dark:bg-slate-900/40", "text-slate-700", "dark:text-slate-300");
      });

      activeBtn.classList.remove("border-slate-200", "dark:border-slate-700", "bg-slate-50", "dark:bg-slate-900/40", "text-slate-700", "dark:text-slate-300");
      activeBtn.classList.add("border-brand-600", "bg-brand-50", "text-brand-700", "dark:border-brand-500", "dark:bg-brand-950/40", "dark:text-brand-300", "font-semibold");
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
      const t = I18N[clientLang];
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
          document.getElementById("form-card").classList.add("hidden");
          const successCard = document.getElementById("success-card");
          successCard.classList.remove("hidden");

          // 回显该用户刚提交的工单凭据与详细内容（绝不向普通用户展示后台表格）
          document.getElementById("ticket-id-display").textContent = result.data?.ticket_id || ("T-" + Date.now().toString(36));
          document.getElementById("ticket-cat-display").textContent = selectedCategory || "默认";
          document.getElementById("ticket-email-display").textContent = email || "未提供";
          document.getElementById("ticket-content-display").textContent = content;

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

    function resetForm() {
      document.getElementById("content").value = "";
      document.getElementById("email").value = "";
      document.getElementById("char-count").textContent = "0 / 1000";
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

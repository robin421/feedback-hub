/**
 * Feedback Hub - 配置与环境健康检查工具 (Doctor)
 * 运行方式: npm run doctor 或 node scripts/doctor.js
 */

import fs from "node:fs";
import path from "node:path";

const rootDir = process.cwd();
const devVarsPath = path.join(rootDir, ".dev.vars");
const wranglerPath = path.join(rootDir, "wrangler.toml");

console.log("\n🔍 ===== 开始执行 Feedback Hub 配置健康诊断 =====\n");

let hasErrors = false;
let hasWarnings = false;

// 1. 检查核心工程文件
console.log("【1. 工程核心文件核验】");
const requiredFiles = [
  "wrangler.toml",
  "package.json",
  "src/index.js",
  "clients/FeedbackHub.kt",
  "clients/FeedbackHub.swift",
  "clients/feedback_hub.dart",
  "clients/feedback-hub.js"
];

for (const file of requiredFiles) {
  if (fs.existsSync(path.join(rootDir, file))) {
    console.log(`  ✓ 找到核心文件: ${file}`);
  } else {
    console.error(`  ✗ 缺失文件: ${file}`);
    hasErrors = true;
  }
}

// 2. 检查本地环境变量文件 (.dev.vars)
console.log("\n【2. 本地开发配置文件 (.dev.vars)】");
let envConfig = {};

if (fs.existsSync(devVarsPath)) {
  console.log("  ✓ 找到 .dev.vars 本地开发配置文件");
  const content = fs.readFileSync(devVarsPath, "utf-8");
  for (const line of content.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eqIdx = trimmed.indexOf("=");
    if (eqIdx !== -1) {
      const key = trimmed.slice(0, eqIdx).trim();
      const val = trimmed.slice(eqIdx + 1).trim();
      envConfig[key] = val;
    }
  }
} else {
  console.warn("  ⚠️ 未检测到 .dev.vars 文件（仅本地开发调试时需要，线上请使用 wrangler secret put）");
  console.warn("     提示: 您可以复制 .dev.vars.example 为 .dev.vars，或运行 npm run setup 一键生成。");
  hasWarnings = true;
}

// 3. 检查 Gemini API Key
console.log("\n【3. Google Gemini API 连通性核验】");
const geminiKey = process.env.GEMINI_API_KEY || envConfig.GEMINI_API_KEY;
if (!geminiKey || geminiKey.includes("your_gemini_api_key_here")) {
  console.warn("  ⚠️ GEMINI_API_KEY 尚未配置真实密钥");
  console.warn("     影响: Worker 将自动启用离线降级逻辑，无法进行智能翻译与反垃圾识别。");
  console.warn("     获取: https://aistudio.google.com/");
  hasWarnings = true;
} else {
  console.log("  ✓ 检测到 GEMINI_API_KEY，正在测试连通性...");
  const model = process.env.GEMINI_MODEL || envConfig.GEMINI_MODEL || "gemini-3-flash-preview";
  try {
    const res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${geminiKey}`,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [{ parts: [{ text: "ping" }] }],
          generationConfig: { maxOutputTokens: 5 }
        })
      }
    );
    if (res.ok) {
      console.log(`  ✓ Gemini API (${model}) 连通测试成功！`);
    } else {
      console.warn(`  ⚠️ Gemini API 响应异常 (HTTP ${res.status}): 请检查 Key 是否具有调用权限。`);
      hasWarnings = true;
    }
  } catch (err) {
    console.warn(`  ⚠️ 无法连通 Gemini API (${err.message})，可能存在网络代理或地区限制。`);
    hasWarnings = true;
  }
}

// 4. 检查 GitHub Token
console.log("\n【4. GitHub Token 与权限核验】");
const githubToken = process.env.GITHUB_TOKEN || envConfig.GITHUB_TOKEN;
if (!githubToken || githubToken.includes("github_pat_your_token_here")) {
  console.warn("  ⚠️ GITHUB_TOKEN 尚未配置真实密钥");
  console.warn("     影响: 无法自动在 GitHub 仓库中创建 Issue 工单。");
  console.warn("     配置指南: 请查阅 docs/GITHUB_SETUP_GUIDE.md");
  hasWarnings = true;
} else {
  console.log("  ✓ 检测到 GITHUB_TOKEN，正在验证有效性...");
  try {
    const res = await fetch("https://api.github.com/user", {
      headers: {
        "Authorization": `Bearer ${githubToken}`,
        "User-Agent": "Feedback-Hub-Doctor"
      }
    });
    if (res.ok) {
      const userData = await res.json();
      console.log(`  ✓ GitHub 认证成功！当前凭证拥有者: @${userData.login}`);
    } else {
      console.warn(`  ⚠️ GitHub Token 校验失败 (HTTP ${res.status})，请检查 Token 是否有效或是否过期。`);
      hasWarnings = true;
    }
  } catch (err) {
    console.warn(`  ⚠️ 连通 GitHub API 失败: ${err.message}`);
    hasWarnings = true;
  }
}

// 5. 检查仓库映射与 wrangler.toml
console.log("\n【5. 仓库分发配置核验】");
if (fs.existsSync(wranglerPath)) {
  const tomlContent = fs.readFileSync(wranglerPath, "utf-8");
  if (tomlContent.includes("your-github-username")) {
    console.warn("  ⚠️ wrangler.toml 中包含占位符 'your-github-username'，请替换为您的真实 GitHub 用户名/组织名。");
    hasWarnings = true;
  } else {
    console.log("  ✓ wrangler.toml 中的仓库配置格式正常。");
  }
}

console.log("\n================ 诊断总结 ================");
if (!hasErrors && !hasWarnings) {
  console.log("🎉 全部配置检测通过！您的 Feedback Hub 随时可以本地调试或直接部署。");
} else if (!hasErrors && hasWarnings) {
  console.log("ℹ️ 项目核心代码完好且测试通过。请根据上述提示补充您的真实 API 密钥与 GitHub 仓库信息即可。");
} else {
  console.log("❌ 检测到异常，请检查上述错误信息。");
}
console.log("=========================================\n");

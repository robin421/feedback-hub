/**
 * 真实端到端测试：向实际配置的 Gemini API 和 GitHub 仓库发起一次工单创建
 */
import worker from "../src/index.js";
import fs from "node:fs";

// 读取 .dev.vars
const env = {};
const lines = fs.readFileSync(".dev.vars", "utf-8").split("\n");
for (const line of lines) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith("#")) continue;
  const eqIdx = trimmed.indexOf("=");
  if (eqIdx !== -1) {
    env[trimmed.slice(0, eqIdx).trim()] = trimmed.slice(eqIdx + 1).trim();
  }
}

console.log("正在使用实际环境配置测试端到端工单提交与 AI 翻译...");

const testPayload = {
  pkg: "aisubdeal",
  ver: "1.0.4",
  os: "macOS 15.0 - Chrome Extension",
  lang: "zh",
  category: "功能建议",
  content: "建议在订阅比价详情页增加一个汇率换算的小工具，方便查看不同货币结算的实际价格差。",
  email: "test-user@example.com",
  extra: { feature: "currency-converter", plan: "pro" }
};

const req = new Request("https://fake-worker.local/api/submit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(testPayload)
});

try {
  const res = await worker.fetch(req, env);
  const data = await res.json();
  console.log("响应状态:", res.status);
  console.log("响应结果:", JSON.stringify(data, null, 2));

  if (data.success && data.data && data.data.issue_url) {
    console.log("\n🎉 端到端实测完全成功！");
    console.log("真实生成的 GitHub Issue 地址:", data.data.issue_url);
  } else {
    console.error("提交异常:", data);
  }
} catch (err) {
  console.error("执行出错:", err);
}

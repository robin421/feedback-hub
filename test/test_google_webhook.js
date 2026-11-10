import worker from "../src/index.js";
import assert from "node:assert";

console.log("测试 Worker 同步 Google Sheet Webhook 组装与发送逻辑...");

let interceptedUrl = null;
let interceptedBody = null;

const originalFetch = globalThis.fetch;
globalThis.fetch = async (url, options) => {
  const urlStr = String(url);
  if (urlStr.includes("script.google.com/macros/s/test-webhook/exec")) {
    interceptedUrl = urlStr;
    interceptedBody = JSON.parse(options.body);
    return new Response(JSON.stringify({ status: "success" }), { status: 200 });
  }
  return originalFetch(url, options);
};

try {
  const fakeEnv = {
    GOOGLE_SHEET_WEBHOOK_URL: "https://script.google.com/macros/s/test-webhook/exec"
  };

  const req = new Request("https://example.com/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      pkg: "aisubdeal",
      ver: "1.0.4",
      os: "macOS 15.0",
      category: "功能建议",
      content: "测试自动同步到 Google Sheets 在线表格，字段完整性核验",
      email: "test@google.com",
      extra: { test: true }
    })
  });

  const res = await worker.fetch(req, fakeEnv);
  assert.strictEqual(res.status, 200);

  // 验证 Google Sheet Webhook 被触发
  assert(interceptedUrl.includes("script.google.com"));
  assert.strictEqual(interceptedBody.pkg, "aisubdeal");
  assert.strictEqual(interceptedBody.email, "test@google.com");
  assert.strictEqual(interceptedBody.content, "测试自动同步到 Google Sheets 在线表格，字段完整性核验");
  assert.strictEqual(interceptedBody.status, "待处理");

  console.log("✓ Google Sheets 同步通道逻辑核验 100% 通过！");
} finally {
  globalThis.fetch = originalFetch;
}

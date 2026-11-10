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

console.log("正在测试移动端/桌面端自适应工单提交并同步腾讯在线文档表格...");

const testPayload = {
  pkg: "fitflow",
  ver: "2.1.0",
  os: "macOS 15.0 - Desktop Safari",
  lang: "zh",
  category: "动作库建议",
  content: "希望能增加哑铃侧平举动作的变式，比如胸肌贴凳斜板侧平举，动作库里目前找不到。",
  email: "fit-dev@example.com",
  extra: { device: "desktop-mac", screen: "1440x900" }
};

const req = new Request("https://fake-worker.local/api/submit", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(testPayload)
});

const res = await worker.fetch(req, env);
const data = await res.json();
console.log("POST /api/submit 状态:", res.status);
console.log("返回结果:", JSON.stringify(data, null, 2));

// 验证 /sheet 路由
const sheetReq = new Request("https://fake-worker.local/sheet", { method: "GET" });
const sheetRes = await worker.fetch(sheetReq, env);
console.log("GET /sheet 状态:", sheetRes.status);

// 验证 /api/tickets
const ticketsReq = new Request("https://fake-worker.local/api/tickets", { method: "GET" });
const ticketsRes = await worker.fetch(ticketsReq, env);
const ticketsData = await ticketsRes.json();
console.log("当前工单列表条数:", ticketsData.data.length);
console.log("最新工单摘要:", ticketsData.data[0].summary);

/**
 * Feedback Hub - 自动化集成与单元模拟测试套件
 * 运行方式: node test/mock_test.js
 */

import assert from "node:assert";
import worker, {
  resolveTargetRepo,
  analyzeWithGemini,
  determineFallbackSeverity,
  mapFallbackCategory,
  renderHTML
} from "../src/index.js";

let passedCount = 0;
let totalCount = 0;

function runTest(testName, fn) {
  totalCount++;
  try {
    fn();
    console.log(`  ✓ [PASS] ${testName}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${testName}`);
    console.error(err);
    process.exitCode = 1;
  }
}

async function runAsyncTest(testName, fn) {
  totalCount++;
  try {
    await fn();
    console.log(`  ✓ [PASS] ${testName}`);
    passedCount++;
  } catch (err) {
    console.error(`  ✗ [FAIL] ${testName}`);
    console.error(err);
    process.exitCode = 1;
  }
}

console.log("\n================ 开始执行 Feedback Hub 测试用例 ================\n");

// 1. 测试静态 H5 渲染与动态参数解析
runTest("GET / 页面渲染包含必要的安全字段、预期管理文案与 Tailwind 资源", () => {
  const html = renderHTML({
    pkg: "com.turboLink.fast",
    ver: "2.1.0",
    os: "Android 14",
    lang: "zh",
    extra: '{"node":"hk-01"}',
    tencentViewUrl: "https://docs.qq.com/sheet/DWndkdE1mTVZNSUtp"
  });

  assert(html.includes("<!DOCTYPE html>"), "应该输出合法的 HTML5 骨架");
  assert(html.includes("cdn.tailwindcss.com"), "应该包含 Tailwind CSS CDN");
  assert(html.includes('name="website_url"'), "应该包含 Honeypot 蜜罐防刷字段");
  assert(html.includes("APP_CONFIG"), "应该包含客户端动态配置字典");
  assert(html.includes("不会进行人工一对一回复"), "应该在界面上包含去客服化预期管理文案");
  assert(html.includes("/sheet"), "应该包含在线工单表格导航直达链接");
});

// 2. 测试仓库路由映射解析
runTest("resolveTargetRepo 正确路由已知包名与默认兜底仓库", () => {
  const env = {
    GITHUB_DEFAULT_REPO: "my-org/custom-inbox",
    REPO_MAP_JSON: JSON.stringify({
      "com.custom.app": "my-org/custom-repo"
    })
  };

  // 已知内置映射
  assert.strictEqual(
    resolveTargetRepo("com.turboLink.fast", env),
    "your-org/nnlink-repo",
    "com.turboLink.fast 应该匹配到对应仓库"
  );

  // 环境变量动态追加的映射
  assert.strictEqual(
    resolveTargetRepo("com.custom.app", env),
    "my-org/custom-repo",
    "环境变量定义的自定义包名应该被正确解析"
  );

  // 未配置的新包名，落入 GITHUB_DEFAULT_REPO 兜底仓库
  assert.strictEqual(
    resolveTargetRepo("unknown.new.app", env),
    "my-org/custom-inbox",
    "未知包名应该自动落入兜底仓库"
  );
});

// 3. 测试降级推断算法
runTest("determineFallbackSeverity 与 mapFallbackCategory 降级推断符合预期", () => {
  assert.strictEqual(determineFallbackSeverity("程序报错/闪退", "每次启动都闪退"), "high");
  assert.strictEqual(determineFallbackSeverity("连接失败", "无法连接香港服务器"), "high");
  assert.strictEqual(determineFallbackSeverity("新功能建议", "希望能加一个深色模式开关"), "low");
  assert.strictEqual(determineFallbackSeverity("其他问题", "这里有个小文案不对"), "medium");

  assert.strictEqual(mapFallbackCategory("程序报错/闪退"), "bug");
  assert.strictEqual(mapFallbackCategory("会员与订阅"), "billing");
  assert.strictEqual(mapFallbackCategory("新功能建议"), "enhancement");
  assert.strictEqual(mapFallbackCategory("其他问题"), "question");
});

// 4. 测试 Gemini 降级保障机制 (当无 API Key 或网络失败时绝不丢单)
await runAsyncTest("analyzeWithGemini 无 API Key 时应平滑降级并保证摘要不超过15字", async () => {
  const content = "这是一个超过十五个字符的很长很长的用户详细反馈内容用来测试降级截断";
  const result = await analyzeWithGemini(content, "功能异常", "test.pkg", {});

  assert.strictEqual(result.is_spam, false);
  assert(result.summary_zh.length <= 15, "降级摘要长度不能超过 15 个字");
  assert.strictEqual(result.translation_zh, content);
  assert(["high", "medium", "low"].includes(result.severity));
  assert(["bug", "enhancement", "billing", "question"].includes(result.category_label));
});

// 5. 测试 Worker POST /api/submit 校验拦截
await runAsyncTest("POST /api/submit 拒绝空内容或少于 10 字的提交", async () => {
  const req = new Request("https://example.com/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category: "Bug",
      content: "太短" // 仅 2 个字
    })
  });

  const res = await worker.fetch(req, {});
  assert.strictEqual(res.status, 400);
  const data = await res.json();
  assert.strictEqual(data.success, false);
  assert(data.error.includes("between 10 and 1000"));
});

// 6. 测试 Honeypot 蜜罐防爬虫拦截（返回 200 假成功，不请求后端）
await runAsyncTest("POST /api/submit 蜜罐字段触发时应静默拦截并返回假成功", async () => {
  const req = new Request("https://example.com/api/submit", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      category: "Bug",
      content: "这是一条正常的超过十个字符的测试反馈内容",
      website_url: "http://bot-spam-url.com" // 机器人填写了隐藏字段
    })
  });

  const res = await worker.fetch(req, {});
  assert.strictEqual(res.status, 200);
  const data = await res.json();
  assert.strictEqual(data.success, true);
  assert.strictEqual(data.message, "Feedback submitted successfully.");
});

// 7. 测试全链路模拟（Mock GitHub API，验证创建 Issue 的完整交互）
await runAsyncTest("POST /api/submit 全链路模拟：成功分发到目标仓库并返回 issue", async () => {
  let createdIssuePayload = null;
  let requestedRepo = null;

  // 模拟全局 fetch 以截获 GitHub 与 Gemini 请求
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    const urlStr = String(url);

    // 截获 Gemini API
    if (urlStr.includes("generativelanguage.googleapis.com")) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      is_spam: false,
                      summary_zh: "节点连接超时",
                      translation_zh: "Connection to node times out repeatedly.",
                      severity: "high",
                      category_label: "bug"
                    })
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }

    // 截获 GitHub API
    if (urlStr.includes("api.github.com/repos/")) {
      const match = urlStr.match(/repos\/(.+?)\/issues/);
      if (match) {
        requestedRepo = match[1];
      }
      createdIssuePayload = JSON.parse(options.body);

      return new Response(
        JSON.stringify({
          number: 108,
          html_url: `https://github.com/${requestedRepo}/issues/108`
        }),
        { status: 201, headers: { "Content-Type": "application/json" } }
      );
    }

    return originalFetch(url, options);
  };

  try {
    const fakeEnv = {
      GEMINI_API_KEY: "mock-gemini-key",
      GITHUB_TOKEN: "mock-github-token",
      GITHUB_DEFAULT_REPO: "test-org/fallback-inbox"
    };

    const req = new Request("https://example.com/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pkg: "com.turboLink.fast",
        ver: "3.0.1",
        os: "Android 14",
        category: "连接失败",
        content: "在开启专线加速后，频繁出现握手超时无法连接节点的问题，请核实",
        email: "user@example.com",
        extra: { server: "jp-tokyo-02" }
      })
    });

    const res = await worker.fetch(req, fakeEnv);
    assert.strictEqual(res.status, 200);
    const body = await res.json();
    assert.strictEqual(body.success, true);
    assert.strictEqual(body.data.issue_number, 108);

    // 验证目标仓库匹配
    assert.strictEqual(requestedRepo, "your-org/nnlink-repo", "应该分发到 com.turboLink.fast 映射的仓库");

    // 验证 GitHub Issue Title 与 Labels
    assert.strictEqual(createdIssuePayload.title, "[连接失败] 节点连接超时 (v3.0.1)");
    assert(createdIssuePayload.labels.includes("user-feedback"));
    assert(createdIssuePayload.labels.includes("severity:high"));
    assert(createdIssuePayload.labels.includes("bug"));
    assert(createdIssuePayload.labels.includes("pkg:com.turboLink.fast"));

    // 验证 Issue Body 中包含扩展业务参数和结构化模块
    assert(createdIssuePayload.body.includes("jp-tokyo-02"), "Issue 详情应该包含 extra 参数");
    assert(createdIssuePayload.body.includes("user@example.com"), "Issue 详情应该包含联系邮箱");
    assert(createdIssuePayload.body.includes("AI 智能分拣与中文翻译"), "Issue 详情应该包含 AI 模块");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

// 8. 测试垃圾信息过滤（is_spam === true 时静默拦截，不调用 GitHub API）
await runAsyncTest("analyzeWithGemini 识别到恶意垃圾信息时，不创建 Issue 并返回 200", async () => {
  let githubCalled = false;
  const originalFetch = globalThis.fetch;

  globalThis.fetch = async (url) => {
    const urlStr = String(url);
    if (urlStr.includes("generativelanguage.googleapis.com")) {
      return new Response(
        JSON.stringify({
          candidates: [
            {
              content: {
                parts: [
                  {
                    text: JSON.stringify({
                      is_spam: true,
                      summary_zh: "垃圾广告拦截",
                      translation_zh: "Spam content",
                      severity: "low",
                      category_label: "question"
                    })
                  }
                ]
              }
            }
          ]
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    if (urlStr.includes("api.github.com")) {
      githubCalled = true;
      return new Response("{}", { status: 200 });
    }
    return originalFetch(url);
  };

  try {
    const fakeEnv = {
      GEMINI_API_KEY: "mock-key",
      GITHUB_TOKEN: "mock-token"
    };

    const req = new Request("https://example.com/api/submit", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        pkg: "com.turboLink.fast",
        category: "其他",
        content: "加微信号 xxxxx 领取博彩优惠券，点击链接免费注册"
      })
    });

    const res = await worker.fetch(req, fakeEnv);
    assert.strictEqual(res.status, 200);
    const data = await res.json();
    assert.strictEqual(data.success, true);
    assert.strictEqual(githubCalled, false, "识别为垃圾信息时绝对不能调用 GitHub API 创建 Issue");
  } finally {
    globalThis.fetch = originalFetch;
  }
});

console.log(`\n================ 测试完成: ${passedCount}/${totalCount} 用例全部通过 ================\n`);

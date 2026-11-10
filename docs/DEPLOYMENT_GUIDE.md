# Feedback Hub 部署与环境配置手册

Feedback Hub 基于 Cloudflare Workers 架构，零服务器运维成本，支持在 Cloudflare 免费版计划（100,000 请求/天）下稳定运行。

---

## 1. 准备工作

1. 安装 Node.js (推荐 v18 或更高版本)。
2. 注册并登录 [Cloudflare Dashboard](https://dash.cloudflare.com/)。
3. 注册并获取 [Google Gemini API Key](https://aistudio.google.com/)。
4. 按照 [`docs/GITHUB_SETUP_GUIDE.md`](./GITHUB_SETUP_GUIDE.md) 生成最小权限的 GitHub Fine-grained Token。

---

## 2. 本地依赖安装

在项目根目录下执行：
```bash
npm install
```

---

## 3. 配置环境变量与 Secrets

### 方式 A：通过 Wrangler CLI 写入 Secrets (推荐，安全可靠)
在终端中依次执行以下命令配置生产密钥：

```bash
# 1. 注入 Gemini API Key (用于翻译、结构化分拣与反垃圾)
npx wrangler secret put GEMINI_API_KEY
# 提示输入时粘贴你的 Gemini API Key

# 2. 注入 GitHub Token (用于跨仓库创建 Issue)
npx wrangler secret put GITHUB_TOKEN
# 提示输入时粘贴你的 GitHub Fine-grained Token
```

### 方式 B：配置 `wrangler.toml` 静态变量
打开根目录下的 `wrangler.toml`，修改默认兜底仓库和动态映射字典：

```toml
name = "feedback-hub"
main = "src/index.js"
compatibility_date = "2024-04-01"

[vars]
# 当提交的 pkg 未在 REPO_MAP 中匹配时，落入此兜底仓库
GITHUB_DEFAULT_REPO = "your-github-username/feedback-inbox"

# (可选) 跨仓库路由映射 JSON，无需重新发版即可通过 Cloudflare Dashboard 实时修改
REPO_MAP_JSON = '{"com.turboLink.fast": "your-github-username/nnlink-repo", "ext.lockbox": "your-github-username/lockbox-repo"}'
```

---

## 4. 本地开发与联调测试

启动本地 Worker 调试服务：
```bash
npm run dev
```

启动后可在浏览器打开 `http://localhost:8787/?pkg=com.turboLink.fast&ver=2.0.1&os=Android%2014&lang=zh` 预览 H5 页面交互与提交逻辑。

同时可直接运行自动化模拟测试验证核心路由、AI 降级与安全拦截机制：
```bash
npm run test
```

---

## 5. 一键发布上线

执行发布命令：
```bash
npm run deploy
```

发布成功后，Wrangler 会输出你的专属 Worker 域名，例如：
`https://feedback-hub.<your-subdomain>.workers.dev`

---

## 6. 绑定自定义域名 (可选但推荐)

为了获得更专业的品牌形象，可在 Cloudflare Dashboard 中绑定你自己的子域名（例如 `feedback.yourdomain.com`）：

1. 打开 Cloudflare 控制台 -> **Workers & Pages** -> 点击 `feedback-hub`。
2. 切换到 **Settings** -> **Triggers**。
3. 在 **Custom Domains** 区域点击 **Add Custom Domain**。
4. 输入你的域名（如 `feedback.yourdomain.com`），Cloudflare 将自动配置 DNS 与 SSL 证书。
5. 将各端客户端 SDK 中的 `baseUrl` 替换为该自定义域名即可。

/**
 * Feedback Hub - 一键配置与环境初始化工具
 * 运行方式:
 * 1. 交互式运行: npm run setup
 * 2. 命令行直传: node scripts/setup.js --user=myname --gemini=AIza... --token=github_pat_...
 */

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";

const rootDir = process.cwd();
const devVarsPath = path.join(rootDir, ".dev.vars");
const wranglerPath = path.join(rootDir, "wrangler.toml");

function parseArgs() {
  const args = {};
  for (const arg of process.argv.slice(2)) {
    if (arg.startsWith("--")) {
      const eqIdx = arg.indexOf("=");
      if (eqIdx !== -1) {
        args[arg.slice(2, eqIdx)] = arg.slice(eqIdx + 1);
      } else {
        args[arg.slice(2)] = true;
      }
    }
  }
  return args;
}

const args = parseArgs();

function askQuestion(rl, query) {
  return new Promise((resolve) => rl.question(query, resolve));
}

async function main() {
  console.log("\n⚙️ ===== Feedback Hub 快捷配置向导 =====\n");

  const isInteractive = !args.user && !args.token && !args.gemini;
  let rl;
  if (isInteractive) {
    rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });
  }

  // 1. 获取 GitHub 用户名或组织名
  let githubUser = args.user || "";
  if (!githubUser && rl) {
    githubUser = (await askQuestion(rl, "1. 请输入您的 GitHub 用户名或组织名 (如: indie-maker): ")).trim();
  }
  githubUser = githubUser || "my-github-user";

  // 2. 默认兜底仓库名
  let defaultRepo = args.repo || `${githubUser}/feedback-inbox`;
  if (!args.repo && rl) {
    const inputRepo = (await askQuestion(rl, `2. 请输入默认兜底反馈仓库 [默认: ${defaultRepo}]: `)).trim();
    if (inputRepo) defaultRepo = inputRepo;
  }

  // 3. Gemini API Key
  let geminiKey = args.gemini || "";
  if (!geminiKey && rl) {
    geminiKey = (await askQuestion(rl, "3. 请输入 Google Gemini API Key (可按回车跳过稍后填写): ")).trim();
  }
  geminiKey = geminiKey || "your_gemini_api_key_here";

  // 4. GitHub Fine-grained Token
  let githubToken = args.token || "";
  if (!githubToken && rl) {
    githubToken = (await askQuestion(rl, "4. 请输入 GitHub Fine-grained Token (可按回车跳过稍后填写): ")).trim();
  }
  githubToken = githubToken || "github_pat_your_token_here";

  if (rl) rl.close();

  // 写入 .dev.vars (用于本地开发 wrangler dev)
  const devVarsContent = `# Cloudflare Workers 本地开发环境变量 (Wrangler 自动读取)
GEMINI_API_KEY=${geminiKey}
GITHUB_TOKEN=${githubToken}
GITHUB_DEFAULT_REPO=${defaultRepo}
REPO_MAP_JSON={"com.turboLink.fast":"${githubUser}/nnlink-repo","ext.lockbox":"${githubUser}/lockbox-repo"}
`;

  fs.writeFileSync(devVarsPath, devVarsContent, "utf-8");
  console.log(`\n✓ 已更新本地配置文件: .dev.vars`);

  // 更新 wrangler.toml
  if (fs.existsSync(wranglerPath)) {
    let toml = fs.readFileSync(wranglerPath, "utf-8");
    toml = toml.replace(/your-github-username/g, githubUser);
    fs.writeFileSync(wranglerPath, toml, "utf-8");
    console.log(`✓ 已更新 wrangler.toml 中的默认仓库为: ${githubUser}`);
  }

  console.log("\n================ 配置完成！================");
  console.log("【本地测试】");
  console.log("  执行: npm run dev");
  console.log("  浏览器打开: http://localhost:8787/?pkg=com.turboLink.fast&lang=zh");
  console.log("\n【发布到 Cloudflare 生产环境】");
  console.log("  如果需要在生产环境运行，请执行以下命令将密钥绑定到 Cloudflare：");
  console.log(`  npx wrangler secret put GEMINI_API_KEY`);
  console.log(`  npx wrangler secret put GITHUB_TOKEN`);
  console.log(`  npm run deploy`);
  console.log("===========================================\n");
}

main().catch(console.error);

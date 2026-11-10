# GitHub 权限配置与跨仓库聚合总看板指南

本项目通过 Cloudflare Worker 调用 GitHub REST API，根据提交的项目包名（`pkg`）自动将用户反馈派发到对应的独立代码仓库。

为了保证多仓库的资产安全并实现零维护的敏捷管理，请按照以下两部分进行配置：
1. **生成最小权限的 GitHub Fine-grained Personal Access Token**
2. **配置 GitHub Account-level Projects 跨仓库统一反馈看板**

---

## 一、配置最小权限 GitHub Fine-grained Token

> [!IMPORTANT]
> 绝不要使用拥有全部仓库最高权限的 Classic Token！请务必使用 GitHub 官方推荐的 **Fine-grained Personal Access Tokens**，遵循最小权限原则（Principle of Least Privilege），将其严格限制在 Issues 读写权限内。

### 1. 创建步骤
1. 登录 GitHub，点击右上角头像 -> **Settings**（个人设置）。
2. 在左侧菜单栏最下方，点击 **Developer settings**。
3. 选择 **Personal access tokens** -> **Fine-grained tokens**。
4. 点击右上角 **Generate new token**。

### 2. 参数设置明细
- **Token name**: `feedback-hub-worker`
- **Expiration**: 建议设置为 `90 days` 或 `1 year`（根据安全策略定期轮换）。
- **Resource owner**: 选择你的个人用户名（或所属 GitHub Organization）。
- **Repository access**:
  - 勾选 **Only select repositories**（仅对选定仓库生效）；
  - 在下拉列表中勾选你矩阵下的所有产品仓库，以及兜底的反馈仓库（例如 `your-org/feedback-inbox`、`your-org/nnlink-repo`、`your-org/lockbox-repo`）。
- **Permissions（仓库权限）**:
  - 点击展开 **Repository permissions**；
  - 找到 **Issues**，将权限设置为：**Read and write**；
  - **重要**：其他所有权限（Contents、Actions、Pull requests、Administration 等）**全部保持 None（无权限）**。即使 Worker 密钥泄露，也无法篡改代码或破坏仓库。

### 3. 保存并注入 Worker Secrets
生成 Token 后（形如 `github_pat_11A...`），请立即复制并在本地终端执行：
```bash
npx wrangler secret put GITHUB_TOKEN
# 粘贴生成的 github_pat_xxxxxx
```

---

## 二、配置 GitHub Projects 跨仓库总看板

独立开发者维护多个独立 App 时，最痛苦的是频繁切换多个仓库查看 Issues。通过 GitHub 账号/组织层级的 **Projects (v2)**，可以在一个看板中聚合全部 App 的反馈工单，实现零上下文切换。

### 1. 新建全局 Project
1. 进入个人 GitHub 主页（`https://github.com/你的用户名?tab=projects`）或组织主页。
2. 点击 **Projects** 选项卡 -> **New project**。
3. 选择 **Board** 视图模板，命名为 **Product Matrix Feedback**。

### 2. 配置跨仓库自动化入库规则 (Auto-add items)
1. 在 Project 看板右上角，点击 `···` 更多菜单 -> **Workflows**。
2. 在左侧列表中选择 **Auto-add to project**。
3. 点击 **Edit**：
   - **Repositories**: 选择你矩阵下的所有代码仓库；
   - **Filter query（过滤表达式）**:
     ```text
     is:issue is:open label:user-feedback
     ```
4. 点击右上角 **Save and turn on** 启用规则。
> *生效后，Cloudflare Worker 在任何产品仓库中创建带有 `user-feedback` 标签的 Issue，都会被自动抓取并吸纳进该总看板！*

### 3. 看板最佳视图规划（按仓库或严重级泳道）

在 Project 看板顶部，可以创建多个专属 View：

#### 视图 A：按产品仓库分组（Matrix Overview）
- **Layout**: Board（看板）
- **Group by**: `Repository`
- **作用**：横向泳道清晰展示 `TurboLink`、`LockBox`、`Inbox` 等各个产品的待处理反馈数量，直观平衡开发精力。

#### 视图 B：紧急故障排查（High Priority First）
- **Layout**: Table（列表）
- **Filter**: `is:issue is:open label:severity:high`
- **Sort by**: `Newest`
- **作用**：AI 自动标记为 `severity:high` 的崩溃与严重 bug（闪退、无法连接、扣费问题）优先置顶处理。

---

## 三、去客服化的敏捷闭环工作流

1. **自动入库**：用户在客户端提交工单 -> AI 翻译、提炼 15 字核心标题、评定严重级别 -> 写入对应仓库 Issue -> 自动落入全局 Project 看板。
2. **批量解决**：在本地开发修复 Bug 时，提交 Commit 或 PR 时关联 Issue 编号，例如：
   ```bash
   git commit -m "fix(sync): resolve vault auto-sync crash on Android 14 (closes #24)"
   ```
3. **静默关闭**：PR 合并后，Issue 自动关闭，看板卡片自动移至 `Done`。由于我们在前端已有效建立“不承诺一对一回复，专注代码修复”的心理预期，全流程零人工客服沟通成本。

# GitHub 功能完全指南

本文档详细介绍 GitHub 平台上对你项目最有价值的功能，包括使用场景、快速开始和官方文档链接。

---

## 📑 目录

1. [🚀 Actions（CI/CD）](#actions)
2. [📝 Issues（问题跟踪）](#issues)
3. [🔀 Pull Requests（代码评审）](#pull-requests)
4. [📊 Projects（项目管理）](#projects)
5. [💾 Releases（版本发布）](#releases)
6. [🤖 Agents（AI 编码助手）](#agents)
7. [📚 Wiki（项目文档）](#wiki)
8. [🔒 Security and quality（安全与质量）](#security)
9. [📈 Insights（数据分析）](#insights)
10. [⚙️ Settings（配置管理）](#settings)

---

## 🚀 Actions（CI/CD 流程自动化）

### 你已经在用 ✅
你的 `build-apk.yml` 就是 Actions 的最佳实践：
- 自动构建 APK
- 发布到 Releases
- 支持矩阵策略构建多个变体（online/offline）

### 主要功能

| 功能 | 用途 | 你项目的应用 |
|------|------|-----------|
| **Workflow（工作流）** | 在代码事件触发时自动执行任务 | push 代码→自动构建 APK |
| **Jobs & Steps** | 工作流的基本单位 | 构建、测试、发布等步骤 |
| **Matrix Strategy** | 在多个环境/配置下并行运行 | 同时构建 online 和 offline 版本 |
| **Secrets** | 安全存储敏感信息 | API keys、tokens、签名文件 |
| **Artifacts** | 保存构建产物 | APK 文件、构建日志 |
| **Environment** | 环境变量隔离 | 生产/测试环境配置 |

### 快速参考

```yaml
# 常见触发事件
on:
  push:                    # 代码 push
  pull_request:           # PR 创建/更新
  schedule:               # 定时运行（比如每天 3 点备份）
    - cron: '0 3 * * *'
  workflow_dispatch:      # 手动触发（按钮）
  release:                # 发布 release 时

# 使用 secrets（在 Settings > Secrets and variables > Actions 配置）
- run: |
    echo "${{ secrets.MY_SECRET }}" > secret.txt

# 访问上文步骤的输出
- id: build
  run: echo "output=success" >> $GITHUB_OUTPUT
- run: echo ${{ steps.build.outputs.output }}

# 矩阵策略（你已在用）
strategy:
  matrix:
    variant: [online, offline]
  fail-fast: false
```

### ���阶用法

**A. 定时备份数据到远程**
```yaml
name: Daily Backup
on:
  schedule:
    - cron: '0 2 * * *'  # 每天凌晨 2 点

jobs:
  backup:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: tar -czf backup.tar.gz data/
      - uses: actions/upload-artifact@v4
        with:
          name: daily-backup
          path: backup.tar.gz
          retention-days: 30  # 只保留 30 天
```

**B. PR 提交时自动 lint + test**
```yaml
name: Lint and Test
on:
  pull_request:
    paths: ['app.js', 'style.css']  # 只在这些文件改动时运行

jobs:
  lint:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - run: npm install eslint
      - run: npx eslint app.js
```

**C. 推送时自动更新 README 的构建状态**
```yaml
- name: Update README badge
  run: |
    sed -i 's/Status: .*/Status: ✅ Passing/' README.md
    git config user.name "github-actions[bot]"
    git config user.email "github-actions[bot]@users.noreply.github.com"
    git add README.md
    git commit -m "chore: update build status badge"
    git push origin main
```

### 📚 官方文档

- **完整文档**：https://docs.github.com/en/actions
- **Workflow 语法**：https://docs.github.com/en/actions/writing-workflows/workflow-syntax-for-github-actions
- **触发事件**：https://docs.github.com/en/actions/using-workflows/events-that-trigger-workflows
- **Secrets 管理**：https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions
- **Workflow 命令**：https://docs.github.com/en/actions/using-workflows/workflow-commands-for-github-actions
- **矩阵策略**：https://docs.github.com/en/actions/using-jobs/using-a-matrix-for-your-jobs

### 你可以做的事

```bash
# 查看 Actions 运行日志
GitHub 上：Actions → 选择 workflow → 选择 run → 查看日志

# 下载 artifact
GitHub 上：Actions → Summary → 下载 artifact ZIP

# 手动触发 workflow（有 workflow_dispatch）
GitHub 上：Actions → 选择 workflow → Run workflow
```

---

## 📝 Issues（问题跟踪与需求管理）

### 主要功能

| 功能 | 用途 |
|------|------|
| **Issue** | 报告 bug、提议功能、讨论设计 |
| **Labels** | 给 issue 分类（bug、feature、documentation） |
| **Milestones** | 按版本或时间分组 issue |
| **Assignee** | 分配责任人 |
| **Project** | 关联到项目看板 |
| **Autolink** | 在 PR 中自动链接相关 issue |

### 使用场景

**场景 1：用户反馈 bug**
```
创建 Issue
├─ Title: "离线版标注后无法同步到云端"
├─ Body: 详细复现步骤
├─ Label: bug
├─ Milestone: v2.0
└─ Project: Bible Study Roadmap
```

**场景 2：新功能请求**
```
创建 Issue
├─ Title: "支持按颜色筛选标注"
├─ Label: enhancement
├─ Body: 用户价值说明
└─ 讨论可行性
```

### 快速开始

1. **创建 Issue**：Code → Issues → New issue
2. **添加 Label**：右侧面板 Labels（需要先在 Settings 创建标签模板）
3. **创建标签模板**（Settings > Labels）
   ```
   bug          - 红色 ff0000
   enhancement  - 绿色 00ff00
   documentation - 蓝色 0000ff
   help wanted  - 橙色 ff7700
   ```

4. **在 PR 中自动关闭 Issue**
   ```
   PR description 中写：
   Closes #123
   Fixes #124
   Resolves #125
   ```
   merge PR 后，这些 issue 自动关闭。

### 高阶用法

**A. Issue 模板（自动化反馈流程）**

创建 `.github/ISSUE_TEMPLATE/bug_report.md`：
```markdown
---
name: Bug Report
about: 报告一个 bug
---

## 问题描述
<!-- 清楚地描述问题是什么 -->

## 复现步骤
1. 打开应用
2. 点击...
3. 观察到...

## 期望行为
应该发生什么

## 实际行为
实际发生了什么

## 环境
- 系统：iOS / Android
- 版本：v1.0.0
- 是否已离线：是/否
```

**B. Issue 自动分类工作流**
```yaml
# .github/workflows/auto-label.yml
name: Auto-label issues
on:
  issues:
    types: [opened]

jobs:
  label:
    runs-on: ubuntu-latest
    steps:
      - if: contains(github.event.issue.body, 'crash') || contains(github.event.issue.body, '崩溃')
        run: |
          gh issue edit ${{ github.event.issue.number }} --add-label "bug,critical"
        env:
          GH_TOKEN: ${{ github.token }}
```

### 📚 官方文档

- **Issues 完整指南**：https://docs.github.com/en/issues
- **Issue 模板**：https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests
- **Labels**：https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work
- **Milestones**：https://docs.github.com/en/issues/using-labels-and-milestones-to-track-work/about-milestones

---

## 🔀 Pull Requests（代码评审与协作）

### 核心概念

| 概念 | 说明 |
|------|------|
| **PR** | 提议代码更改（通常来自 feature 分支→main） |
| **Commit** | 单次代码改动的历史记录 |
| **Review** | 团队成员审查代码并提出意见 |
| **Merge** | 将 PR 代码合并到主分支 |
| **Conflict** | 多个 PR 改同一文件时产生的冲突 |

### 你项目的应用

现在你已经有了自动化流程：
```
feature 分支 → push → PR → build-apk.yml 自动构建 → 验证成功 → merge → 发布 release
```

### 快速开始

**本地工作流：**
```bash
# 1. 创建 feature 分支
git checkout -b feature/add-search

# 2. 修改代码、提交
git add app.js
git commit -m "feat: add full-text search"

# 3. 推送到 GitHub
git push origin feature/add-search

# 4. GitHub 上创建 PR（自动建议）
#    - 写清楚改动说明
#    - 关联相关 issue
#    - 等待 CI 检查和评审

# 5. 合并后，拉取最新代码
git checkout main
git pull origin main
git branch -d feature/add-search
```

### 高阶用法

**A. PR 模板（确保规范）**

创建 `.github/pull_request_template.md`：
```markdown
## 描述
<!-- 简要说明改动内容 -->

## 相关 Issue
Closes #123

## 改动类型
- [ ] Bug fix（修复 bug）
- [ ] New feature（新功能）
- [ ] Breaking change（破坏性改动）
- [ ] Documentation（文档）

## 测试方法
<!-- 如何验证这个改动 -->
1. 打开离线版
2. 创建标注
3. 验证同步状态

## Checklist
- [ ] 代码自测通过
- [ ] 无 console 错误
- [ ] 测试了 online 和 offline 两个版本
- [ ] 更新了文档/注释

## Screenshots
<!-- 如果改动涉及 UI，附图 -->
```

**B. 需要 review 才能 merge（保护主分支）**

Settings > Branches > Add branch protection rule：
```
Branch name pattern: main

✅ Require a pull request before merging
✅ Require approvals (最少 1 人)
✅ Require status checks to pass before merging
   - 选择 build-apk.yml 的所有 jobs
✅ Dismiss stale pull request approvals when new commits are pushed
✅ Require conversation resolution before merging
```

**C. 自动检查 PR 改动**
```yaml
name: PR Validation
on:
  pull_request:
    types: [opened, synchronize]

jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: 检查 PR 标题格式
        run: |
          PR_TITLE="${{ github.event.pull_request.title }}"
          if ! echo "$PR_TITLE" | grep -E '^(feat|fix|chore|docs|style|test)\('; then
            echo "::error::PR 标题必须以 'feat()' 或 'fix()' 等开头"
            exit 1
          fi

      - name: 检查文件大小
        run: |
          LARGE_FILES=$(find . -size +5M -type f ! -path './.git/*' ! -path './node_modules/*')
          if [ -n "$LARGE_FILES" ]; then
            echo "::error::检测到超过 5MB 的文件："
            echo "$LARGE_FILES"
            exit 1
          fi
```

### 📚 官方文档

- **PR 完整指南**：https://docs.github.com/en/pull-requests
- **创建 PR**：https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/proposing-changes-to-your-work-with-pull-requests/creating-a-pull-request
- **PR 模板**：https://docs.github.com/en/communities/using-templates-to-encourage-useful-issues-and-pull-requests/creating-a-pull-request-template-for-your-repository
- **分支保护规则**：https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches/about-protected-branches
- **代码评审最佳实践**：https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests

---

## 📊 Projects（项目管理与看板）

### 主要功能

GitHub Projects 是看板式的项目管理工具（类似 Trello），支持：
- **表格视图**（按状态、优先级排序）
- **看板视图**（拖拽卡片在不同列）
- **路线图视图**（按时间线展示）
- **自动化**（issue 状态变化时自动移动卡片）

### 快速开始

**创建 Projects：**

1. GitHub 主页 → Projects → New Project
2. 选择模板：
   - 📋 Table（表格）
   - 🗂️ Board（看板）
   - 📅 Roadmap（路线图）

**配置看板（以 Board 为例）：**
```
列名：
├─ Backlog（待处理）
├─ In Progress（进行中）
├─ Review（审查中）
├─ Testing（测试中）
└─ Done（完成）

自动化规则：
├─ PR open → "In Progress"
├─ PR approve → "Review"
├─ Issue close → "Done"
```

### 对你项目的建议

**创建「Bible Study v2.0 Roadmap」项目：**

```
Backlog:
- [ ] 支持按颜色筛选标注（#45）
- [ ] 添加快速笔记模板
- [ ] 标注导出为 PDF
- [ ] 多用户云同步

In Progress:
- [x] 数据分层加载
- [x] PWA 缓存策略升级

Done:
- [x] 统一 main 分支，消除 offline 分支（v1.5）
- [x] CI/CD 自动构建两个 APK（v1.5）
```

### 📚 官方文档

- **Projects 完整指南**：https://docs.github.com/en/issues/planning-and-tracking-with-projects
- **创建 Project**：https://docs.github.com/en/issues/planning-and-tracking-with-projects/creating-projects/creating-a-project
- **字段和视图**：https://docs.github.com/en/issues/planning-and-tracking-with-projects/customizing-views-in-your-project
- **Project 自动化**：https://docs.github.com/en/issues/planning-and-tracking-with-projects/automating-your-project

---

## 💾 Releases（版本管理）

### 你已经在用 ✅

你的 `build-apk.yml` 最后一步就是自动发布 Release：
```yaml
gh release create "$TAG" "bible-study-${BRANCH}.apk" \
  --title "读经 v${VERSION} · ${LABEL}" \
  --notes "..."
```

### 主要功能

| 功能 | 用途 |
|------|------|
| **Release** | 标记代码库的某个稳定版本 |
| **Tag** | 指向某个 commit 的别名（v1.0.0） |
| **Release Notes** | 版本更新说明（changelog） |
| **Assets** | 上传二进制文件（APK、可执行文件等） |

### 快速参考

```bash
# 本地创建 tag
git tag -a v1.0.0 -m "Version 1.0.0"
git push origin v1.0.0

# GitHub 自动识别 tag，显示为 Release
# 手动添加 Release Notes（GitHub UI）
```

### 高阶用法

**自动生成 Changelog**

```yaml
# .github/workflows/release.yml
name: Create Release Notes
on:
  push:
    tags:
      - 'v*'

jobs:
  release:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
        with:
          fetch-depth: 0

      - name: 生成 Changelog
        run: |
          VERSION="${{ github.ref_name }}"
          PREV_TAG=$(git describe --tags --abbrev=0 "$VERSION"^ 2>/dev/null || echo "")
          
          if [ -n "$PREV_TAG" ]; then
            CHANGELOG=$(git log "$PREV_TAG"..."$VERSION" --oneline --format="- %s")
          else
            CHANGELOG=$(git log "$VERSION" --oneline --format="- %s")
          fi
          
          echo "$CHANGELOG" > CHANGELOG.txt

      - name: 创建 Release
        env:
          GH_TOKEN: ${{ github.token }}
        run: |
          gh release create "${{ github.ref_name }}" \
            --title "Version ${{ github.ref_name }}" \
            --notes-file CHANGELOG.txt
```

### 📚 官方文档

- **Releases 完整指南**：https://docs.github.com/en/repositories/releasing-projects-on-github
- **创建 Release**：https://docs.github.com/en/repositories/releasing-projects-on-github/managing-releases-in-a-repository
- **自动发布**：https://docs.github.com/en/repositories/releasing-projects-on-github/automation-for-release-forms-with-query-parameters

---

## 🤖 Agents（AI 编码助手）

### 主要功能

**GitHub Copilot Agents** 可以：
- 🔧 自动修复 issue（我就是！）
- 🧪 生成测试用例
- 📝 撰写 PR 描述
- 🐛 调试代码问题
- 📚 生成文档

### 对你项目的应用

**场景 1：快速修复 bug**
```
Issue: "标注颜色丢失"
  ↓
Copilot Agent 接手
  ↓
- 分析代码
- 定位问题（localStorage 容量溢出）
- 生成修复代码
- 创建 PR
- 附加测试用例
```

**场景 2：实现新功能**
```
Issue: "支持笔记导出为 PDF"
  ↓
Copilot Agent 接手
  ↓
- 评估实现难度
- 提议方案（pdfkit、jsPDF）
- 生成核心代码
- 创建 PR
- 更新文档
```

### 快速开始

在 Issue 中 @copilot（需要 Copilot Pro 订阅）：
```
@copilot fix 离线版无法正确处理上/下半节的标注
```

或者在 Copilot Chat（VSCode 插件中）：
```
@workspace 怎样优化 bible-text.json 的加载性能？
```

### 📚 官方文档

- **Copilot Agents**：https://docs.github.com/en/copilot/about-github-copilot/what-is-github-copilot
- **在 GitHub 中使用 Copilot**：https://docs.github.com/en/copilot/managing-copilot/managing-copilot-in-your-organization
- **Copilot Chat**：https://docs.github.com/en/copilot/github-copilot-chat/about-github-copilot-chat

---

## 📚 Wiki（项目文档）

### 主要功能

GitHub Wiki 是项目内置的文档站点，支持：
- 📄 Markdown 编写
- 🔗 内部链接
- 📑 自动目录生成
- 🔍 全文搜索

### 对你项目的建议

创建以下页面结构：
```
Home
├─ Getting Started（快速开始）
│  ├─ 安装与配置
│  ├─ 第一次使用
│  └─ 快捷键
├─ User Guide（用户指南）
│  ├─ 标注系统详解
│  ├─ 生命读经功能
│  ├─ 云同步配置
│  └─ 常见问题
├─ Developer Guide（开发指南）
│  ├─ 本地开发环境
│  ├─ 项目结构
│  ├─ CI/CD 工作流
│  └─ 贡献指南
├─ Architecture（架构文档）
│  ├─ 离线/在线版本差异
│  ├─ 数据同步机制
│  └─ PWA 缓存策略
└─ Roadmap（路线图）
   ├─ v1.5 完成
   ├─ v2.0 规划
   └─ 用户反馈
```

### 快速开始

1. Code → Wiki → Create the first page
2. 用 Markdown 编写
3. 链接：`[链接文字](页面名)` 会自动指向 wiki 页面

### 📚 官方文档

- **Wiki 指南**：https://docs.github.com/en/communities/documenting-your-project-with-wikis

---

## 🔒 Security and quality（安全与质量）

### 主要功能

| 功能 | 用途 |
|------|------|
| **Dependabot** | 自动检查依赖项的安全漏洞和更新 |
| **Code scanning** | 自动检查代码中的安全问题 |
| **Secret scanning** | 检测是否误上传了密钥/token |
| **Branch protection** | 保护重要分支的规则 |

### 对你项目的建议

**启用 Dependabot（自动更新依赖）：**

Settings → Code security and analysis → Enable Dependabot alerts

这样当 `@capacitor/core`、`@capacitor/android` 等包有更新时，会自动创建 PR 建议升级。

**配置 Dependabot PR**（可选）：

创建 `.github/dependabot.yml`：
```yaml
version: 2
updates:
  - package-ecosystem: "npm"
    directory: "/"
    schedule:
      interval: "weekly"
      day: "monday"
    allow:
      - dependency-type: "indirect"
      - dependency-type: "direct"
    open-pull-requests-limit: 5
    reviewers:
      - "all-the-day"
```

### 📚 官方文档

- **Security overview**：https://docs.github.com/en/code-security
- **Dependabot**：https://docs.github.com/en/code-security/dependabot
- **Code scanning**：https://docs.github.com/en/code-security/code-scanning/introduction-to-code-scanning
- **Secret scanning**：https://docs.github.com/en/code-security/secret-scanning/about-secret-scanning

---

## 📈 Insights（数据分析与洞察）

### 主要功能

| 图表 | 说明 |
|------|------|
| **Network** | 分支历史和合并情况 |
| **Forks** | 项目被 fork 的情况 |
| **Stargazers** | star 数量变化趋势 |
| **Traffic** | 项目访问量 |
| **Pulse** | 一段时间内的活跃情况 |
| **Community** | 社区健康度评分 |

### 查看方式

1. Code → Insights（顶部菜单）
2. 选择具体图表查看

### 用处

- 📊 了解项目受欢迎程度
- 👥 追踪贡献者活跃度
- 📉 发现项目发展趋势
- 🏥 检查社区健康度（缺失 README、CONTRIBUTING 等时会报警）

### 📚 官方文档

- **Repository insights**：https://docs.github.com/en/repositories/viewing-activity-and-data-for-your-repository

---

## ⚙️ Settings（仓库配置与管理）

### 核心配置项

| 配置 | 位置 | 用途 |
|------|------|------|
| **Repository name** | Settings > General | 项目名称 |
| **Description** | Settings > General | 项目描述（显示在 Code 页） |
| **Visibility** | Settings > General | Public/Private |
| **Default branch** | Settings > General | 默认分支（推荐：main） |
| **Branch protection** | Settings > Branches | 保护 main 分支的规则 |
| **Secrets** | Settings > Secrets and variables | CI/CD 密钥管理 |
| **Collaborators** | Settings > Collaborators | 添加团队成员 |
| **Pages** | Settings > Pages | 项目 GitHub Pages 站点 |
| **Webhooks** | Settings > Webhooks | 外部集成（Discord、Slack 等） |

### 推荐配置

**1. 保护 main 分支**

Settings → Branches → Add rule：
```
Branch name pattern: main

✅ Require a pull request before merging
✅ Require status checks to pass
✅ Require conversation resolution
✅ Require code reviews before merging
✅ Dismiss stale reviews on new push
```

**2. 配置 Actions 密钥**

Settings → Secrets and variables → Actions → New repository secret

常见密钥（你项目中可能需要）：
```
ANDROID_KEYSTORE      # APK 签名证书
ANDROID_KEY_PASSWORD  # 证书密钥
SIGNING_KEY_ALIAS     # 签名别名
BIBLE_ADMIN_TOKEN     # 反馈 API token
```

**3. 启用 Pages（托管文档网站）**

Settings → Pages → Build and deployment：
```
Source: Deploy from a branch
Branch: main
Folder: docs/  或 /
```

然后在项目中创建 `docs/index.html`，自动发布到 `https://all-the-day.github.io/bible-study/`

**4. 添加 Webhook（自动同步到外部服务）**

Settings → Webhooks → Add webhook：
```
Payload URL: https://你的服务器/webhook
Content type: application/json
Events: Push events, Release events
Active: ✅

# 这样每当你 push 代码或发布 Release 时，
# GitHub 会 POST 事件到你的服务器做后续处理
# 比如：自动更新线上版本、发送通知等
```

### 📚 官方文档

- **Settings 完整指南**：https://docs.github.com/en/repositories/managing-your-repositorys-settings-and-features
- **分支保护**：https://docs.github.com/en/repositories/configuring-branches-and-merges-in-your-repository/managing-protected-branches
- **Secrets**：https://docs.github.com/en/actions/security-guides/using-secrets-in-github-actions
- **Pages**：https://docs.github.com/en/pages/getting-started-with-github-pages
- **Webhooks**：https://docs.github.com/en/webhooks

---

## 🎯 快速决策表

你什么时候应该用哪个功能？

```
❓ 我遇到了一个 bug
└─→ 创建 Issue（label: bug）
    └─→ Copilot Agent 修复
        └─→ 创建 PR
            └─→ CI 自动构建验证
                └─→ merge 后自动发布 Release

❓ 我想开发一个新功能
└─→ 创建 Issue（label: enhancement）
    └─→ 添加到 Projects 看板（In Progress）
        └─→ 创建 feature 分支
            └─→ 提交 PR（填写 PR 模板）
                └─→ Actions 自动测试/构建
                    └─→ 团队 review
                        └─→ merge 后移到 Projects Done

❓ 我想发布一个新版本
└─→ 更新 package.json 版本号
    └─→ 创建 tag（v1.0.0）
        └─→ push tag 后 Actions 自动：
            ├─ 构建 APK
            ├─ 生成 Release Notes
            └─ 发布到 Releases

❓ 我想监控项目健康度
└─→ Insights → Pulse（最近 7 天活跃情况）
    └─→ Insights → Community（缺失文件提示）
        └─→ Projects（看板进度）
            └─→ Issues 统计（未处理数量）

❓ 我想招募贡献者
└─→ 完善 README
    └─→ 创建 CONTRIBUTING.md
        └─→ 打上 "help wanted" label
            └─→ 在 Discussions 发公告
                └─→ 创建新手友好的 Issue
```

---

## 💡 你项目的完整工作流（推荐）

```
1️⃣ 规划阶段
   ├─ Issues 里收集用户反馈
   ├─ Projects 看板规划
   └─ Wiki 记录设计决策

2️⃣ 开发阶段
   ├─ 创建 feature 分支
   ├─ 本地开发
   ├─ 提交 PR（关联 Issue）
   └─ 填写 PR 模板

3️⃣ 验证阶段
   ├─ Actions 自动构建/测试
   ├─ 团队 review
   ├─ Resolve conflicts
   └─ Merge 到 main

4️⃣ 发布阶段
   ├─ 更新版本号
   ├─ 创建 Release tag
   ├─ Actions 自动：
   │  ├─ 构建 APK
   │  ├─ 生成 Release Notes
   │  └─ 发布到 Releases
   └─ 发公告（Discussions / 其他渠道）

5️⃣ 反馈阶段
   ├─ 用户报告 bug / 新需求
   ├─ Issue 收集
   ├─ Insights 分析
   └─ 回到 1️⃣ 规划阶段
```

---

## 📚 学习资源

### 官方文档
- **GitHub 完全文档**：https://docs.github.com
- **GitHub 最佳实践**：https://docs.github.com/en/communities

### 推荐文章
- **GitHub Actions 入门**：https://docs.github.com/en/actions/learn-github-actions
- **代码评审最佳实践**：https://docs.github.com/en/pull-requests/collaborating-with-pull-requests/reviewing-changes-in-pull-requests/about-pull-request-reviews
- **Git 命令参考**：https://git-scm.com/doc

### 实践建议
1. ✅ 现在就启用 branch protection（main 分支）
2. ✅ 创建 Issue 和 PR 模板
3. ✅ 启用 Dependabot 自动更新依赖
4. ✅ 创建 Projects 看板追踪功能开发
5. ✅ 编写 CONTRIBUTING.md 吸引贡献者
6. ✅ 使用 Wiki 记录项目文档

---

## 🎓 下一步

1. 📖 阅读感兴趣的功能文档（本文档中有链接）
2. 🔧 在项目中逐个启用功能
3. 💬 有问题随时问我！

祝你开发顺利！🚀

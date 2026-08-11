<div align="center">

# do-code

**开源 Coding Agent。**

在自己的终端与工作区中阅读代码、修改文件、运行命令，并验证结果。

[![CI](https://github.com/tree201/do-code/actions/workflows/ci.yml/badge.svg)](https://github.com/tree201/do-code/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-20.19%2B%20%7C%2022.12%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md) | [Español](README.es-ES.md) | [Français](README.fr-FR.md)

[快速开始](#安装) · [使用文档](docs/README.md) · [贡献](CONTRIBUTING.md) · [安全策略](SECURITY.md)

</div>

<p align="center">
  <img src="assets/terminal-preview.png" alt="do-code 终端界面预览" width="100%">
</p>

---

## 安装

需要 Node.js `20.19+` 或 `22.12+`。

当前可直接从源码运行：

```bash
git clone https://github.com/tree201/do-code.git
cd do-code
npm install
npm run build:agent
npm link
```

进入一个已有项目并开始使用：

```bash
cd /path/to/your-project
do-code auth
do-code
```

`do-code auth` 会引导配置模型服务。API Key 仅保存在本机用户配置中；环境变量可覆盖本地配置。

> [!NOTE]
> 可使用 `npm install -g @tree201/do-code` 安装。首次使用建议在 Git 仓库中运行，并从默认权限模式开始。

## 用 do-code 做什么

- **在真实工作区完成任务**：读取和引用文件、修改代码、执行 Shell 命令、查看 Git Diff、运行测试。
- **接入自己的模型服务**：内置 Volcengine Ark、Alibaba ModelStudio、DeepSeek、MiniMax、Z.AI 和 ModelScope；Custom Provider 支持 OpenAI-compatible、Anthropic 与 Gemini API。
- **保持执行可控**：计划模式与权限模式彼此独立；内置文件编辑和补丁会创建本地检查点，方便检查或恢复。

输入 `/` 浏览命令，输入 `@` 引用工作区文件：

```text
/plan · /permissions · /model · /resume
/status · /stats · /compact · /diff
/memory · /rewind · /export · /language
@src/app.ts           将文件加入当前上下文
!npm test             运行命令（遵循当前权限）
```

使用 `/thinking` 和 `/effort` 可在会话中调整推理设置；添加 `--persist` 可保存为未来会话的默认值。界面支持 English、Simplified Chinese、Japanese、Korean、Spanish 和 French，可通过 `--language` 或 `/language` 切换。

## 运行方式

### 交互式终端

```bash
do-code
do-code --continue
do-code resume <session-id>
```

### 会话与上下文

使用 `do-code --continue` 继续当前项目的最新会话，也可通过 `resume` 和 `/resume` 选择会话：

```bash
do-code sessions list
do-code sessions search "authentication"
do-code sessions rename <session-id> "Auth cleanup"
do-code sessions delete <session-id>
do-code sessions export <session-id> md ./session.md
```

使用 `/stats` 查看上下文用量，使用 `/compact` 手动压缩。接近上下文上限时，do-code 会自动压缩，并保留重要路径、命令、决策和验证状态。

### 项目指令与隔离

分层 `AGENTS.md` 指令遵循工作区层级，可通过 `/memory` 查看或重新加载。使用 `do-code --worktree` 或 `do-code --worktree=<name>` 在隔离 Git worktree 中运行，使用 `do-code worktrees` 查看 do-code worktree。

### 配置档与扩展

Agent profile 可选择 model、approval mode、instructions、step limit 和 tool allow/deny lists。使用 `do-code agents` 查看，通过 `do-code --agent <name>` 选择。使用 `/extensions` 浏览 Markdown commands 和 skills；使用 `do-code extensions` 汇总查看 commands、skills 与已配置的 MCP servers。

### 脚本与 CI

`run` 提供稳定的 JSON / JSONL 输出，适合外部自动化调用。任务可来自命令参数或 `--task-file`；`--max-steps` 与 `--timeout` 控制执行预算。`--artifact-dir` 保存冻结配置、事件流、结果和补丁产物。

```bash
do-code run --yes --output-format stream-json \
  --task-file task.txt --artifact-dir ./artifacts \
  --max-steps 40 --timeout 600
```

也可通过 `do-code acp` 使用 ACP 标准输入/输出协议。其自动化契约详见 [Headless / JSONL 协议](docs/headless-protocol.md)。

### 图片输入

在 headless 模式中重复使用 `--image`，最多可附加四张 PNG、JPEG、GIF 或 WebP 图片。所选模型必须支持图片输入。

```bash
do-code run --image screenshots/bug.png --image screenshots/diagram.webp "描述这些图片"
```

在交互式 TUI 中，输入 `@path/to/image.png`，或使用 `/paste-image` 从系统剪贴板导入图片。使用 `/remove-image <index|name>` 可移除待发送附件。每张图片最大 10 MB，单次提示中的图片总量最大 20 MB。导入的文件会复制到 `~/.local/share/do-code/projects/<project-key>/sessions/<session-id>/attachments/`；持久化消息只保存 `attachments/image_xxx.png` 这类相对引用，不保存 Base64 数据或原始绝对路径。设置 `DO_CODE_DATA_DIR` 可覆盖全局数据根目录。项目内已有的 `.do-code` 数据会在下次访问该项目时迁移到用户管理的项目目录。

### 常用 CLI 命令

```bash
do-code config show          # 查看生效的模型配置
do-code doctor               # 检查模型、工作区与本地工具
do-code sessions list        # 列出项目会话
do-code extensions           # 检查 commands、skills 与 MCP 配置
do-code agents               # 列出 agent profiles
do-code worktrees            # 列出隔离 worktrees
do-code errors list          # 列出近期错误报告
```

## 安全与数据

默认的 **Ask** 模式会在高风险操作前请求确认；**Auto** 自动处理普通工作区改动；**Full Access** 仅适用于已信任的工作区或 CI。

配置保存在 `~/.config/do-code/`；项目会话、附件、检查点和错误报告保存在 `~/.local/share/do-code/projects/<project-key>/`。`DO_CODE_DATA_DIR` 可覆盖数据根目录。凭据与项目数据默认都留在本机。

Sandbox 设置可使用 local execution、macOS Seatbelt 或 container，具体取决于配置和宿主支持。权限模式与 sandbox 配置是彼此独立的控制项。

出现异常时：

```bash
do-code errors list
do-code errors show <error-id>
```

## 文档

- [使用说明与命令导航](docs/README.md)
- [Bad Case 回流与错误诊断](docs/bad-case-feedback.md)
- [Headless / JSONL 协议](docs/headless-protocol.md)
- [架构说明](docs/architecture.md)
- [本地开发流程](docs/local-development.md)
- [个人发布流程](docs/releasing.md)

## 参与贡献

欢迎提交 Issue 与 Pull Request。开始前请阅读 [贡献指南](CONTRIBUTING.md) 和 [安全策略](SECURITY.md)。

```bash
npm run verify:local
npm run build:agent
```

## License

[Apache-2.0](LICENSE)

<div align="center">

# do-code

[![CI](https://github.com/tree201/do-code/actions/workflows/ci.yml/badge.svg)](https://github.com/tree201/do-code/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-20.19%2B%20%7C%2022.12%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

**面向真实项目工作的、本地优先的开源 Coding Agent。**

在终端中阅读、修改和验证代码；模型、权限与会话都由你掌控。

[快速开始](#快速开始) · [使用说明](docs/README.md) · [贡献](CONTRIBUTING.md)

</div>

## 为什么是 do-code？

- **本地优先**：在你的工作区、终端和 Git 仓库中执行；会话、检查点、错误报告和 API Key 不会上传到 do-code 服务。
- **适配国内与国际模型**：通过一个交互向导接入火山方舟、阿里云百炼、DeepSeek、MiniMax、智谱、ModelScope，以及 OpenAI-compatible、Anthropic 和 Gemini 服务。
- **为真实改代码而设计**：支持工作区文件引用、Shell、Git Diff、会话恢复、上下文压缩、检查点恢复、计划模式与权限控制。
- **可自动化集成**：提供稳定的 Headless/JSONL 接口，适用于 CI、脚本与外部评测器。

> [!NOTE]
> do-code 处于公开 Beta。它会直接操作你指定的工作区；首次使用请在 Git 仓库中运行，并从默认的审批模式开始。

## 安装与快速开始

需要 Node.js 20.19+ 或 22.12+。

首次 npm Beta 发布完成后，安装方式是：

```bash
npm install -g do-code@beta

cd /path/to/your-project
do-code auth       # 选择模型服务并保存本地配置
do-code            # 开始对话
```

在 npm 包首次发布前，请从源码本地安装：

```bash
git clone https://github.com/tree201/do-code.git
cd do-code
npm install
npm run build:agent
npm link

cd /path/to/your-project
do-code auth
do-code
```

`do-code auth` 会引导完成模型配置。API Key 只保存在本机用户配置中，Shell 环境变量会覆盖本地配置。

```bash
do-code doctor     # 检查 Node、模型、工作区与本机工具
do-code --continue # 继续最近一次会话
do-code sessions   # 浏览、搜索、导出或删除会话
```

## 使用方式

| 场景 | 命令 | 说明 |
| --- | --- | --- |
| 交互式开发 | `do-code` | 终端对话、`@文件` 引用、`/` 命令与多轮会话。 |
| 恢复会话 | `do-code resume <session-id>` | 载入此前对话和工作区上下文。 |
| 脚本 / CI | `do-code run --yes "修复失败测试并验证"` | 非交互执行，支持 JSON 或 JSONL 输出。 |
| 自动化集成 | `do-code acp` | 通过 ACP 标准输入/输出运行 Agent。 |
| 模型管理 | `do-code auth` / `do-code config` | 使用向导配置或查看已脱敏的模型预设。 |

在交互界面中：

```text
/plan                 进入只读规划；Shift+Tab 可快速切换
/permissions           选择 Ask / Auto / Full Access 权限模式
/model                 查看或切换模型预设
/resume                恢复历史会话
/bug <说明>            保存脱敏的本地 Bad Case，并生成错误 ID
@src/app.ts            将工作区文件加入当前上下文
!npm test              直接执行 Shell 命令（会遵循当前权限）
```

完整命令与快捷键请看 [使用说明](docs/README.md)。

## 安全模型

默认的 **Ask** 模式会在高风险操作前请求确认；**Auto** 仅自动处理普通工作区改动；**Full Access** 适合已信任的工作区或 CI。计划模式是独立状态，不会静默改变你的权限模式。

每次编辑前会创建本地检查点，可通过 `/restore` 和 `/rewind` 恢复。遇到异常时可用 `do-code errors show <error-id>` 查看可复现的本地诊断信息。

## 开发与发布

```bash
npm test
npm run typecheck
npm run build
npm pack ./packages/cli --dry-run
```

- [文档导航](docs/README.md)
- [贡献指南](CONTRIBUTING.md)
- [安全策略](SECURITY.md)
- [个人发布流程](docs/releasing.md)
- [变更记录](CHANGELOG.md)

## 许可证

[Apache-2.0](LICENSE)。

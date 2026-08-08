<div align="center">

# do-code

**开源 Coding Agent。**

在自己的终端与工作区中阅读代码、修改文件、运行命令，并验证结果。

[![CI](https://github.com/tree201/do-code/actions/workflows/ci.yml/badge.svg)](https://github.com/tree201/do-code/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-20.19%2B%20%7C%2022.12%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

[English](README.md) | [简体中文](README.zh-CN.md)

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
- **接入自己的模型**：内置火山方舟、百炼、DeepSeek、MiniMax、智谱、ModelScope，也支持 OpenAI-compatible、Anthropic 与 Gemini 服务。
- **保持执行可控**：计划模式与权限模式彼此独立；每次编辑会创建本地检查点，方便检查或恢复。

输入 `/` 浏览命令，输入 `@` 引用工作区文件：

```text
/plan                 在只读模式下探索并提出计划
/permissions          选择 Ask / Auto / Full Access
/model                 查看或切换模型预设
/resume                恢复历史会话
@src/app.ts           将文件加入当前上下文
!npm test             运行命令（遵循当前权限）
```

## 运行方式

### 交互式终端

```bash
do-code
do-code --continue
do-code resume <session-id>
```

### 脚本与 CI

`run` 提供稳定的 JSON / JSONL 输出，适合外部自动化调用：

```bash
do-code run --yes --output-format stream-json "修复失败测试并验证"
```

也可通过 `do-code acp` 使用 ACP 标准输入/输出协议。详见 [Headless / JSONL 协议](docs/headless-protocol.md)。

## 安全与数据

默认的 **Ask** 模式会在高风险操作前请求确认；**Auto** 自动处理普通工作区改动；**Full Access** 仅适用于已信任的工作区或 CI。

会话、检查点、错误报告与凭据默认都留在本机。出现异常时：

```bash
do-code errors list
do-code errors show <error-id>
```

## 文档

- [使用说明与命令导航](docs/README.md)
- [Bad Case 回流与错误诊断](docs/bad-case-feedback.md)
- [Headless / JSONL 协议](docs/headless-protocol.md)
- [架构说明](docs/architecture.md)
- [个人发布流程](docs/releasing.md)

## 参与贡献

欢迎提交 Issue 与 Pull Request。开始前请阅读 [贡献指南](CONTRIBUTING.md) 和 [安全策略](SECURITY.md)。

```bash
npm test
npm run typecheck
npm run build
```

## License

[Apache-2.0](LICENSE)

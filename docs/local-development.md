# 本地自开发流程

本文说明如何使用稳定的 do-code 开发 do-code 自身，同时快速验证源码改动，并在验证通过后立即更新本机正在使用的版本。

## 设计目标

本地开发使用两个相互独立的入口：

| 命令 | 代码来源 | 用途 |
| --- | --- | --- |
| `do-code` | `dist/src/cli.js` 构建产物 | 日常实际开发使用的稳定本地版本 |
| `do-code-dev` | `src/cli.ts` 当前源码 | 验证刚完成但尚未构建的改动 |

这样即使当前源码暂时存在语法错误或功能回归，已构建的 `do-code` 仍然可以继续帮助修复源码。

## 首次准备

在 do-code 源码目录执行：

```bash
cd "/Users/liwangping/Desktop/02_CODE_代码项目/do-code-home/do-code"
npm install
npm run activate:local
npm link
```

`npm link` 会注册两个全局命令：

```text
do-code
do-code-dev
```

通常只需执行一次 `npm link`。以下情况才需要重新执行：

- 修改了 `package.json` 中的 `bin` 配置。
- 移动了 do-code 源码目录。
- 全局 npm 链接被删除或损坏。

## 推荐的双终端流程

### 终端 A：使用稳定版开发 do-code

进入 do-code 源码目录：

```bash
cd "/Users/liwangping/Desktop/02_CODE_代码项目/do-code-home/do-code"
do-code
```

这个进程运行上一次验证并构建成功的 `dist`，适合让 do-code 阅读、修改和测试自己的源码。

### 终端 B：即时验证当前源码

进入需要进行真实验证的工作区，例如：

```bash
cd "/Users/liwangping/Desktop/01_WORK_工作/工作项目/test-demo"
do-code-dev
```

`do-code-dev` 直接运行 do-code 仓库中的 `src/cli.ts`，但仍把执行命令时的当前目录作为目标工作区。

源码发生变化后：

1. 退出当前 `do-code-dev` 进程。
2. 再次运行 `do-code-dev`。
3. 重现刚修改的交互或功能。

无需先构建，也无需重复执行 `npm link`。

## 验证和激活

源码功能验证正常后，在 do-code 源码目录执行：

```bash
npm run activate:local
```

该命令依次运行：

```bash
npm run typecheck
npm test
npm run build:agent
```

类型检查或测试失败时，构建步骤不会执行，当前稳定版 `dist` 不会被新的构建覆盖。

激活成功后，退出正在运行的稳定版 do-code，并重新启动：

```bash
do-code
```

新进程会立即加载最新构建产物。

## 常用命令

直接验证当前源码：

```bash
do-code-dev
```

只运行类型检查和全量测试，不更新构建产物：

```bash
npm run verify:local
```

验证通过后更新稳定本地版本：

```bash
npm run activate:local
```

检查两个入口实际加载的位置：

```bash
do-code doctor
do-code-dev doctor
```

输出中的 `Launcher` 应分别指向：

```text
scripts/cli-entry.js
scripts/dev-cli-entry.js
```

## 重要边界

### 运行中的进程不会热更新

Node.js 进程启动后已经加载的代码不会因为文件变化自动替换：

- 修改源码后，需要重启 `do-code-dev` 才能验证最新源码。
- 执行 `npm run activate:local` 后，需要重启 `do-code` 才能使用最新构建。

不要在一个正在修改自身代码的 do-code 进程中期待它自动切换到新实现。

### 配置由两个入口共享

`do-code` 和 `do-code-dev` 默认读取相同的用户配置，例如：

```text
~/.config/do-code/config.json
```

因此模型、API Key 和语言设置通常无需重复配置。测试认证或配置迁移功能时，应注意源码版可能修改真实用户配置。需要隔离时可以临时指定配置文件：

```bash
DO_CODE_CONFIG_PATH="/tmp/do-code-dev-config.json" do-code-dev
```

### 构建不等于重建全局链接

全局 `do-code` 已通过 `npm link` 指向当前源码仓库。日常更新只需：

```bash
npm run activate:local
```

构建完成后，链接会自动读取新的 `dist`，不需要再次执行 `npm link`。

## 最短日常流程

```text
稳定版 do-code 修改源码
        ↓
另一个终端重启 do-code-dev 验证
        ↓
npm run activate:local
        ↓
重启 do-code
```

如果改动尚未验证，不要执行激活命令；继续保留当前稳定构建即可。

## 如何和 AI 沟通

仓库根目录的 [`AGENTS.md`](../AGENTS.md) 已记录这套开发规则。使用 do-code、OpenCode、Codex 或其他支持 `AGENTS.md` 的 Coding Agent 进入本仓库时，通常不需要重复解释稳定版和源码版的区别。

你只需要描述目标、现象和期望结果。建议包含以下信息：

- 你刚才做了什么。
- 实际发生了什么，最好附上报错或截图。
- 你期望发生什么。
- 是否要求 AI 在修改后激活稳定版。

### 修复问题并自动验证

```text
/auth 的模型列表按 Enter 后报 Provider ID 错误。请定位根因、修复、补回归测试，并运行类型检查和测试。先不要更新稳定版。
```

AI 应修改当前源码并完成自动化验证，但不会覆盖你正在使用的稳定构建。修改完成后，在另一个终端重启 `do-code-dev` 进行手动验证。

### 修复后立即更新稳定版

```text
请修复这个问题，补测试并完整验证。验证通过后执行本地激活，让我重启 do-code 后立即使用。
```

最后一句明确授权 AI 执行：

```bash
npm run activate:local
```

### 只分析，不改代码

```text
先帮我分析这个问题的根因和可选方案，不要修改代码，也不要激活稳定版。
```

### 开发一个新功能

```text
给 /auth 增加模型名称过滤。请先检查现有 AuthDialog 和 ModelDialog 的交互模式，保持现有 TUI 风格，补交互测试。完成后告诉我如何用 do-code-dev 手动验证，暂时不要激活。
```

### 手动验证后让 AI 激活

当你已用 `do-code-dev` 验证通过，可以继续说：

```text
我已经用 do-code-dev 验证通过。请运行完整验证并激活到稳定版。
```

### 一个通用模板

```text
现象：<实际发生的事情>
期望：<希望变成什么样>
复现：<操作步骤、命令、截图或错误信息>
要求：请定位根因，做最小正确修改，补回归测试并完成自动化验证。
激活：<先不要激活稳定版 / 验证通过后立即激活稳定版>
```

不需要使用严格格式。直接用自然语言描述也可以，模板只是帮助 AI 更快掌握边界。

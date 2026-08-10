# do-code 架构

do-code 是一个本地优先的 Coding Agent：CLI 直接在用户指定的工作区执行，并把会话、检查点与诊断信息保留在本机。

## 运行边界

- **CLI**：`src/` 提供交互式终端、Headless/JSONL 和 ACP 入口；模型与 API Key 仅保存在本机配置。
- **Agent Core**：负责会话、上下文、工具调用、检查点、权限与错误报告。
- **UI model boundary**：`src/ui/transcript-model.ts` 保存 transcript 的数据类型和纯序列化/状态判断；React 组件只负责渲染和交互，不再拥有这部分领域逻辑。

## 依赖方向

新模块优先按以下方向依赖：

```text
UI interaction -> UI model / capabilities -> Agent Core
Headless / ACP -> Agent Core
Core -X-> React components
```

首个拆分从 transcript 模型开始。后续拆分应保持行为不变，并先用现有测试保护公开函数和交互契约。

## 发布边界

npm 只发布 `packages/cli` 中的终端程序；仓库不包含评测服务、数据集或运行产物。

## 安全边界

默认权限模式会对风险操作请求确认；计划模式独立于权限模式。每次修改前创建本地检查点，错误报告会脱敏保存，并可用错误 ID 在本机复现。

## 数据边界

会话、事件、附件和默认会话导出保存在 `~/.local/share/do-code/projects/<project-key>/`，以规范化工作区绝对路径的可读名称和哈希隔离；项目内 `.do-code/` 仅用于项目级配置及尚未迁移的项目运行功能。旧 `.do-code/sessions/` 会在下次访问该项目会话时迁移到全局数据目录。

外部系统可以使用 [Headless JSONL 协议](headless-protocol.md) 调用 do-code，并在隔离工作区中自行保存评分数据与产物。

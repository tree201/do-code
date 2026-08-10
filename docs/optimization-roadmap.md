# do-code 优化与解耦路线

## 目标

在保持现有产品能力和用户行为一致的前提下，逐步降低模块耦合、提高可测试性和可维护性，并为后续私有化部署、Headless、ACP 和其他客户端保留清晰边界。

当前不以减少功能为目标。以下能力继续作为官方默认体验提供：

- Agent Loop
- 多模型和 Provider
- 文件、Shell、网络和 Patch 工具
- Session、Compaction、Checkpoint
- Permission Policy、Workspace Trust 和 Sandbox
- Plan、Todo、MCP 和 Background Shell
- 图片附件
- TUI、Headless JSONL 和 ACP
- Prompt Extensions

## 总原则

```text
先保护现有行为
    -> 再建立模块契约
    -> 再拆分实现职责
    -> 最后基于基线做性能优化
```

- 先补测试，再移动生产代码。
- 任何生产文件拆分前，必须先为即将迁移的职责补充行为测试或模块契约测试；测试通过后才允许移动实现。
- 每次只拆一个明确职责。
- 保留必要的兼容导出，避免一次性破坏调用方。
- 核心模块不得依赖 React、Ink 或具体 TUI 组件。
- Provider 适配器不负责通用重试、UI 状态或会话管理。
- 工具描述操作意图，权限策略统一决定是否允许执行。
- Session 记录事件和状态，不依赖 UI 状态。
- 不回退或覆盖已有未提交改动。

## 目标边界

```text
TUI / CLI / Headless / ACP
              ↓
       Application Services
              ↓
     Official Capabilities
              ↓
        Core Contracts
              ↓
        Core Runtime
```

禁止的依赖方向：

```text
Core -> React / Ink
Core -> ChatApp
Model -> TUI
Session -> UI state
Tool -> React
```

## 测试策略

测试分为两类：

### 行为保护测试

记录当前产品必须保持的行为，包括：

- Agent 工具调用和事件顺序。
- 工具失败、取消、超时和最大步数处理。
- Permission、Workspace Boundary、Sandbox 和 Checkpoint。
- Session 保存、恢复和历史工具只读展示。
- Model Stream、SSE、图片能力、Retry 和 Timeout。
- Config Migration、配置层合并和认证来源优先级。
- Slash Command、Completion、Composer、Dialog 和 Transcript。

### 模块契约测试

定义未来模块之间的稳定行为：

- Agent Runtime 输出有序、可取消、可分类的事件。
- Model Adapter 统一输出模型流事件。
- Tool Executor 接受统一执行上下文并支持 AbortSignal。
- Session Store 支持追加、恢复和导出。
- Permission Policy 在执行前统一介入，并且失败时默认拒绝。

不要求所有测试一次性补完。准备拆哪个模块，就先补齐该模块及其边界测试，再迁移实现。

## 测试基础设施

优先复用并逐步完善以下测试替身：

- Fake Model：预设文本、流式 delta、工具调用、空回复、超时、重试和取消。
- Fake Tool：验证 Agent 调度，不依赖真实文件系统。
- Temporary Workspace：隔离文件、工作区外路径和符号链接场景。
- Local HTTP Server：模型和网络协议测试不访问公网。
- Event Assertions：断言事件类型、顺序、step、callId、错误分类和重试次数。

性能测试先建立基线，不使用脆弱的绝对时间断言。重点检测明显退化：

- 长 Transcript 查看和滚动。
- 连续流式输出的重渲染。
- Tool Schema 构建。
- Session 恢复和 Compaction。
- MCP 初始化。

## 开发阶段

### Phase 0：基线和规则

- 记录当前测试、类型检查和构建基线。
- 盘点公开导出、Agent Events、Tools、Commands 和配置入口。
- 维护架构文档和本路线文档。

### Phase 1：核心行为保护

优先补充：

- Agent Loop、Agent Events、Tool 调度。
- 取消、超时、最大步数、重试和恢复。
- Permission、Sandbox、Workspace Boundary、Checkpoint。
- Session Restore 和 Compaction。
- Model Stream、SSE、Provider Retry、Config Migration。

### Phase 2：TUI 和交互保护

- Slash Command 和 Completion。
- Transcript、Dialog、Composer、Message Queue。
- Resize、长消息滚动、流式输出和图片附件。

### Phase 3：逐模块解耦

建议顺序：

1. `src/ui/chat-app.tsx`
2. `src/tools.ts`
3. `src/model.ts`
4. `src/config.ts`

建议拆分方向：

```text
chat-app.tsx
  -> transcript model
  -> Agent event projector
  -> slash command router
  -> session actions
  -> model actions
  -> dialog coordinator

tools.ts
  -> tool contract
  -> registry
  -> filesystem
  -> patch
  -> shell
  -> network
  -> background
  -> planning / interaction

model.ts
  -> model types
  -> SSE parser
  -> retry policy
  -> content normalization
  -> provider adapters

config.ts
  -> schema
  -> loader
  -> migration
  -> provider resolution
  -> auth diagnostics
```

### Phase 4：性能优化

在测试保护和模块边界稳定后，再处理：

- Transcript 序列化和换行缓存。
- Streaming 局部更新和渲染批处理。
- Tool Schema、配置、指令和 MCP 连接缓存。
- Session 追加式存储和 Compaction 扫描。
- Model 请求构造和重试开销。

详细审计证据、实施顺序和完成状态见 [`performance-audit.md`](./performance-audit.md)。

## 大文件与硬编码约束

后续重构增加以下硬性验收条件：

- `src/**/*.ts`、`src/**/*.tsx`、`test/**/*.ts` 和 `test/**/*.tsx` 中的文件最多 300 行。
- 文件拆分必须按业务职责、逻辑边界和依赖方向进行，禁止按行数机械截断。
- 拆分任何生产文件前，必须先新增并通过覆盖该职责的行为测试或模块契约测试。
- 所有新增业务硬编码必须抽离到对应领域的常量、配置或文案模块。
- 已有硬编码按领域逐步迁移，不要求一次性改造，但每次迁移必须保持行为不变并补充回归保护。
- 每个拆分步骤必须先运行 focused tests，再运行全量测试、类型检查和构建。

建议的执行顺序：

1. 建立文件行数、硬编码和架构边界检查及迁移基线。
2. 拆分 `src/agent.ts`。
3. 拆分 `src/config.ts`。
4. 拆分 `src/model.ts`。
5. 拆分 `src/tools.ts`。
6. 拆分 `src/ui/chat-app.tsx`。
7. 拆分 `src/cli.ts`。
8. 在拆分稳定后继续性能优化。

## 每步完成标准

每个重构步骤必须满足：

1. 现有行为保持一致。
2. 新模块有独立测试或契约测试。
3. `npm run typecheck` 通过。
4. `npm test` 通过。
5. `npm run build:agent` 通过。
6. `git diff --check` 通过。
7. 不引入循环依赖。
8. 不泄漏 API Key、配置密钥或工作区敏感内容。

## 当前第一步

先盘点 Agent、工具、安全、Session、Model 和 TUI 测试缺口，优先补充核心行为保护测试。测试稳定后，再开始下一个模块边界拆分。当前不执行本地稳定版激活，除非用户明确要求。

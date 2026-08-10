# do-code 性能审计与实施清单

## 范围

本审计覆盖 TUI 渲染与流式更新、Agent 和 Model 运行时、Session、文件工具、Shell、MCP、Checkpoint、配置加载与后台进程。优化原则是不改变协议、权限、安全边界和用户可见行为，性能测试优先断言调用次数、缓存命中、输出上限和工作量边界，不依赖绝对耗时。

## 已完成

- Transcript 查看器按历史数组、语言和宽度缓存序列化与终端换行结果。
- 流式回答发布按 16ms 窗口合并，并取消陈旧回调。
- `Intl.Segmenter` 在终端文本工具中复用。
- Shell、命令捕获、Sandbox、Hook 和交互命令输出统一使用有界头尾收集器；实时 chunk 回调保持完整。
- Session 仅持久化 durable events，普通消息追加使用 JSONL 增量写入，历史替换时回退到原子重写。
- 流式 viewport 按 delta 增量维护最后 N 行，宽度变化时才重建。
- 图片 Base64 按路径、大小、mtime 和 MIME 缓存，并受总容量限制。
- Message 序列化长度按对象身份缓存。
- Completion 工作区索引和编辑器 cursor grapheme 分段按稳定输入复用。
- CLI 已解析配置传入模型解析、Headless 和交互 Runtime，普通启动不再重复读取。
- MCP Server 并行初始化，工具、错误和 client 仍按配置顺序合并。
- `read_many_files` 使用固定并发度读取，并保持输出顺序。
- 同次工具调用共享 workspace canonical root；无审批路径不重复 realpath，审批后仍二次校验。
- 搜索命令达到输出预算后终止 `rg`，通用命令收集保持有界。
- Checkpoint 内容使用 SHA-256 blob 去重，并兼容旧 `contentBase64` metadata。
- 后台进程仅保留最近 100 个已完成任务，运行中任务不驱逐。
- Anthropic 和 Gemini Tool Schema 按工具数组身份缓存。

## P0：资源放大

### 有界 Shell 与命令输出

状态：已完成。

- 证据：`src/sandbox.ts`、`src/tool-shell.ts` 和 `src/ui/command-output.ts` 使用字符串持续追加完整 stdout/stderr；交互式自定义 Shell 路径还会绕过最终工具输出截断。
- 风险：长日志导致无界内存、重复字符串复制、巨大 Tool 消息和 Session 事件。
- 实施：共享有界输出收集器，保留头尾和省略计数；实时输出回调不截断；所有 Shell 路径统一限制最终结果。
- 验证：大量 chunk 后内存中保留值不超过上限，头尾存在，实时回调完整，默认与自定义 Shell 行为一致。

### Session 增量持久化

状态：已完成。

- 证据：`src/ui/interactive-session-store.ts` 每次保存都完整序列化并原子重写 messages/events；流式 delta 也进入永久事件数组。
- 风险：长会话累计序列化和磁盘写入接近 O(n^2)。
- 实施：只持久化恢复需要的 durable events；Messages 使用快照加增量追加，在历史被替换时回退到原子重写；metadata 独立原子更新。
- 验证：普通追加只写新增记录；Compaction、Restore、Resume 和 Rewind 后完整恢复正确；临时 delta 不进入持久日志。

### 增量流式 viewport

状态：已完成。

- 证据：`boundedLiveOutput` 每次流式发布都从头扫描累计全文并重新切行。
- 风险：长回答累计工作量接近 O(n^2)。
- 实施：delta 驱动的固定尾部窗口，仅保留展示需要的终端行；宽度变化时从有限尾部重建。
- 验证：处理字符数接近输入总量；结果等于完整换行后的最后 N 行；覆盖中文、Emoji 和 resize。

### 图片编码缓存

状态：已完成。

- 证据：每个 Provider 请求都会重新读取历史附件并 Base64 编码。
- 风险：多步骤图片任务重复磁盘读取、编码和大对象分配。
- 实施：按绝对路径、大小和 mtime 缓存 Provider 中立的 Base64 数据，并设置总容量上限。
- 验证：未变化图片跨请求只读取一次；文件变化后失效；持久化格式仍只包含相对路径。

## P1：重复全量计算

### 消息估算缓存

状态：已完成。

- 证据：每个模型步骤多次对完整消息历史执行 `JSON.stringify` 估算 Token。
- 实施：按 Message 对象缓存估算长度，并让 Conversation 维护当前估算结果；历史替换时重建。
- 验证：旧消息不重复估算，追加只处理新增消息，Compaction/Restore 后结果正确。

### Completion 与编辑器缓存

状态：已完成。

- 证据：每次 `@` 输入都重建全部文件和目录索引并全量排序；每次流式刷新都重新分割未变化的编辑器 grapheme。
- 实施：工作区文件变化时构建一次补全索引；`cursorParts` 按 editor 身份缓存。
- 验证：连续查询只构建一次索引，文件列表变化后失效，原排序契约不变。

### 配置复用

状态：已完成。

- 证据：交互启动期间 CLI、模型解析和 TUI Runtime 重复读取三层配置。
- 实施：向模型解析和交互 Runtime 传入已解析配置；显式模型切换时才重新读取。
- 验证：普通启动只加载一次配置，切换或认证后仍可读取新配置。

### MCP 并行初始化

状态：已完成。

- 证据：多个独立 MCP Server 串行 start、tools/list 和 resources/list。
- 实施：并行初始化，最终按配置顺序合并工具和错误。
- 验证：所有 start 在任一阻塞 Server 完成前已触发；顺序、隔离失败和关闭行为不变。

## P2：I/O 和生命周期

- [x] 工具执行复用 workspace canonical root，避免同一无审批调用重复 realpath；审批后仍重新校验。
- [x] `read_many_files` 使用有限并发读取；精确路径的解析结果在同一循环中复用。
- [x] `rg`/命令收集支持最大字符预算，搜索达到预算后终止子进程。
- [x] Checkpoint 使用内容寻址 blob 去重，并兼容读取旧 Base64 格式。
- [x] Background Process 只保留有限数量已完成任务，运行中任务不自动驱逐。
- [x] Provider-specific Tool Schema 按工具数组身份缓存。

## 完成标准

每批优化必须通过 focused tests，并在阶段结束后运行：

```bash
npm test
npm run typecheck
npm run build:agent
npm run check:file-size
npm run check:hardcoded
npm run check:architecture
git diff --check
```

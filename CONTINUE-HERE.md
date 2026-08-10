# 继续工作说明

## 工作目录

```text
/Users/liwangping/Desktop/02_CODE_代码项目/do-code-home/do-code
```

## 已提交：图片内嵌标签

已完成并提交：

```text
cfb3ebc feat: inline image attachment labels
```

功能：

- `Ctrl+V` / `Cmd+V` 粘贴图片后，在输入框光标位置显示 `[Image #1]`。
- Backspace 删除内嵌标签时，同步删除图片附件。
- `/remove-image <index|name>` 同步删除标签。
- 提交时剥离内部附件节点，模型只收到正文和真实图片附件。

## 当前未提交改动：修复 Dialog 测试超时

只修改了：

```text
test/chat-ui-dialogs.test.ts
```

### 原始问题

完整测试原先会运行至工具的 10 分钟超时。根因是 `chat-ui-dialogs.test.ts`：

1. 直接对 Ink 的 `view.lastFrame()` 原始 ANSI 输出做中文文本正则匹配。
   - 样式控制码会插到每个中文字符之间。
   - UI 实际文本正确，但例如 `/建议计划/` 会匹配失败。
2. `view.unmount()` 位于断言之后。
   - 断言失败时 Ink view 不会释放。
   - 残留的渲染计时器或活动句柄使 Node 测试进程无法退出。

### 已实施修复

在 `test/chat-ui-dialogs.test.ts` 中：

- 从 `./support/chat-ui.js` 导入 `visibleFrame`。
- 用 `visibleFrame(view)` 代替针对可见文本的 `view.lastFrame()`。
- 每次 `render(...)` 之后立即通过 `t.after(() => view.unmount())` 注册清理。
- 异步 plan review 测试清理时额外调用 `finishModel?.()`，避免模拟模型长期 pending。
- 删除断言末尾的手动 `view.unmount()`，由 `t.after()` 统一清理。

### 已验证

```bash
time npx tsx --test test/chat-ui-dialogs.test.ts
```

结果：

```text
tests 8
pass 8
fail 0
duration 3.6s
real 4.9s
```

```bash
npm run typecheck
```

通过。

完整测试：

```bash
time npm test
```

现已在约 38 秒正常退出，不再超时：

```text
tests 326
pass 305
fail 21
```

剩余 21 个失败不属于本次超时修复：多数也是其他测试直接匹配 ANSI 原始 frame；少数可能受当前未提交布局改动影响。不要在没有明确要求时扩展修复范围。

## 下一步：只提交 Dialog 测试修复

提交前确认工作区，然后只提交目标文件：

```bash
git status --short
git add -- test/chat-ui-dialogs.test.ts
git commit -m "test: clean up dialog views"
```

不要提交以下已有改动：

```text
AGENTS.md
src/ui/components/transcript-block.tsx
test/chat-ui-layout.test.ts
```

不要 push。

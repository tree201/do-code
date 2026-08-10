# Markdown 表格渲染交接

## 当前目标

修复 `do-code` 终端会话 Markdown 表格中的内联格式渲染，并参考 Qwen Code 的方案改善窄屏可读性。

用户已经确认：**直接参考 Qwen Code 的方案实现**。

本次需求是局部修复 Markdown 表格，不要替换整个 Markdown 渲染架构，也不要为了此问题降级 `marked` 或接入 `marked-terminal`。

## 用户体验问题

当前表格单元格会把 Markdown 源标记原样显示出来，例如：

```text
**按需渲染**
`main.js`
```

这不仅导致视觉错误，也使列宽将 `**` 和反引号计入宽度，造成表格过窄、换行错误。

截图中有类似表格：

```markdown
| 优化点 | 位置 | 说明 |
| --- | --- | --- |
| **按需渲染** | `main.js` `animate()` | 无动画时停止 RAF 循环 |
```

期望：

- `按需渲染` 真正显示为粗体，不显示 `**`。
- `main.js` 显示为代码样式，不显示反引号。
- 宽度依据最终可见内容计算。
- 中文、emoji、长路径正确换行并对齐。
- 终端过窄或单元格换行过多时切换为纵向 `字段: 内容` 格式。

## 当前项目位置

仓库根目录：

```text
/Users/liwangping/Desktop/02_CODE_代码项目/do-code-home/do-code
```

上次会话工作目录在父目录 `do-code-home`，因此 `enter_worktree` 失败；新会话请先进入上面这个 `do-code` Git 仓库目录，再创建 worktree。

当前 Git 状态（在上次会话读取时）：

```text
## main...origin/main [ahead 3]
 M AGENTS.md
 M src/ui/components/transcript-block.tsx
 M test/chat-ui-dialogs.test.ts
 M test/chat-ui-layout.test.ts
```

这些未提交修改是已有 TUI 工作，视为用户工作，**不要覆盖、重置或一并提交**。

当前 HEAD：

```text
cfb3ebc feat: inline image attachment labels
```

此前另有一个相关但更早的本地提交：

```text
8d16387 feat: reduce TUI transcript noise
```

## 关键文件

### 当前 Markdown renderer

`src/ui/markdown.tsx`

现有表格实现的根因：

```tsx
if (token.type === "table") {
  const value = token as Tokens.Table
  const rows = [value.header, ...value.rows].map((row) => row.map((cell) => cell.text))
  // ...
}
```

`cell.text` 保留原始 Markdown 标记，且此表格路径绕过了已有 `InlineTokens`。

已有的非表格内联 renderer：

```tsx
function InlineTokens({ tokens }: { tokens: Token[] }) {
  // strong / em / del / codespan / link / image / br / escape / text
}
```

注意：当前 `codespan` 写法为：

```tsx
<Text color={tuiTheme.accent}>`{text}`</Text>
```

为了和 Qwen 的表格效果一致，**表格专用 renderer 的 inline code 不应显示反引号**；是否同时修改普通段落代码样式不在本次需求范围内。

### 终端文本工具

`src/ui/terminal-text.ts`

已有：

- `displayWidth(value)`：使用 `string-width`，可正确处理中文和 emoji 显示宽度。
- `padTerminalEnd(value, width)`。
- `wrapTerminalLines(value, width)`：按 grapheme cluster 换行，避免切开中文和 emoji。

其不处理 ANSI 样式，因此如果表格采用 ANSI 字符串，需要新增 ANSI 安全的换行/切片策略，不能直接把 ANSI 字符串交给 `wrapTerminalLines`。

### 当前测试

`test/ui-markdown.test.ts`

已有相关用例：

- `markdown tables align Chinese columns by terminal width`
- `narrow markdown tables wrap without dropping cell content`

需要保留或调整这些断言，并补充新的回归测试。

### 项目依赖

`package.json` 当前直接依赖：

```json
{
  "ink": "npm:@jrichman/ink@6.6.9",
  "marked": "^18.0.9",
  "string-width": "^7.2.0"
}
```

不要为了表格问题引入 `ink-markdown` 或替换整套 Markdown renderer。

## 已完成的外部方案调研

### Qwen Code：推荐的参考对象

参考文件：

```text
../参考资料/qwen-code/packages/cli/src/ui/utils/TableRenderer.tsx
```

Qwen 的核心策略：

1. 先将单元格内联 Markdown 转为 ANSI 样式文本。
2. 按去除 ANSI 后的可见文本计算宽度（CJK 兼容）。
3. 按 ANSI 安全方式换行，样式跨行不丢失。
4. 计算列的最小宽度（最长词）和理想宽度（完整可见文本）。
5. 正常宽度画 Unicode 网格表格。
6. 终端太窄或一个单元格换行太多时，切成纵向 key-value 格式。

Qwen 的重要阈值和行为：

- `MIN_COLUMN_WIDTH = 3`
- `MAX_ROW_LINES = 4`
- 横向表格还会考虑边框开销和安全边距。
- 窄屏或最高单元格行数大于 4 时纵向 fallback。
- 支持 Markdown 表格的 `:---`, `:---:`, `---:` 对齐。

Qwen 的实现较大，包含 OSC8 链接、安全净化、流式稳定性、inline math 等；不要整段复制。只借鉴需要的表格布局算法与 fallback。

Qwen Code 仓库为 Apache-2.0。若复制非平凡代码，必须遵守归属/许可证要求；更适合自行按思路重写。

### Gemini CLI

和 Qwen 同样先渲染内联样式再算可见宽度；宽屏网格较简洁，通常只在表头后画横线。用户已经选择 Qwen 方案，不需要再讨论 Gemini。

### OpenCode

将 Markdown 整段交给 OpenTUI：

```tsx
<markdown tableOptions={{ style: "grid" }} />
```

`do-code` 使用 Ink，没有可直接替代的 OpenTUI renderer。

### 开源库结论

没有一个现成库同时解决：

- `marked@18` 兼容性
- Ink 组件树
- Markdown 内联解析
- ANSI 样式安全换行
- CJK / emoji 宽度
- 表格窄屏纵向 fallback

评估结果：

- `ink-markdown`：版本较旧，依赖 `marked-terminal`，不建议。
- `marked-terminal@7.3.0`：MIT，支持表格，但兼容 `marked >=1 <16`，不兼容项目的 `marked@18`；输出 ANSI 字符串而非 Ink 树。
- `cli-table3` / `table`：可做表格布局，但不解析 Markdown，也不提供纵向 fallback。
- `wrap-ansi`：可做 ANSI 样式字符串换行，但不解决 Markdown 或表格布局。

因此已决定：**不引入整套 Markdown 库；在现有 `marked + Ink` 架构中局部重写 table 分支，参考 Qwen 策略。**

## 推荐实现方案

### 1. 表格专用的内联表示

不要直接复用现有 `InlineTokens` 作为列宽布局输入，因为它返回 React 元素而非可测量内容。

可在 `markdown.tsx` 内创建表格专用的扁平结构，例如：

```ts
type StyledTableSegment = {
  text: string
  bold?: boolean
  italic?: boolean
  strikethrough?: boolean
  color?: string
  underline?: boolean
}
```

或使用 ANSI 字符串。但如果使用 ANSI：

- 宽度必须先去除 ANSI。
- 换行、切片必须保留/恢复样式。
- 不能把 ANSI 字符串交给现有 `wrapTerminalLines`。

如果用 React segment：

- 可以复用 Ink 样式能力。
- 需要实现按 `displayWidth` 的分段换行和列内 padding。
- 每一个表格行可作为 `<Box>` + 多列 `<Box width={...}>` 渲染。

建议优先选 **React segment + Ink Box 列布局**，这样不用自行维护 ANSI reset。但要先用测试确认 Ink 在多行列单元格里不会错位。若 Ink 在行布局中出现不可控换行，再改为 ANSI 字符串路线。

### 2. 解析单元格内联 token

`Tokens.Table` 的 cell 有 `text` 与 `tokens`。

- 用 `cell.tokens` 递归渲染 `strong`、`em`、`del`、`codespan`、`link`、`escape`、`text`、`br`。
- `codespan` 的可见内容只保留文本，不保留反引号，并使用 `tuiTheme.accent`。
- 链接显示 label 并使用 accent + underline；不必在本次引入 OSC8。
- 未覆盖 token 安全降级为纯文本。

### 3. 宽度与横向布局

参考 Qwen 但简化：

- 最小列宽 3。
- 理想宽度 = 每列所有单元格最终可见内容的最大宽度。
- 最小宽度 = 每列最长单词的显示宽度；中文无空格时允许 hard wrap。
- 可用宽度 = `contentWidth - 表格边框和列分隔的开销`。
- 理想宽度放得下则使用理想宽度。
- 放不下则按 overflow 比例分配额外宽度。
- 最小宽度仍放不下则按比例压缩，至少 3；必要时 hard wrap。
- 所有输出行的 `displayWidth` 必须不超过 `contentWidth`。
- 支持 `value.align` 的 Markdown 表格列对齐信息，若 `Tokens.Table` 类型定义具备该字段；不要猜字段名，先 inspect `marked` 类型或 `value.align` 实际值。

### 4. 横向表格视觉

用户已要求“参考 Qwen”，使用清晰的完整 Unicode grid：

```text
┌──────┬──────────┬─────────┐
│ 标题 │ 标题     │ 标题    │
├──────┼──────────┼─────────┤
│ 内容 │ 内容     │ 内容    │
└──────┴──────────┴─────────┘
```

不要在每一条数据行之间增加横线，除非实际从 Qwen 的目标行为另有要求；此前讨论的 Gemini 视觉建议只是可选，用户已指定 Qwen。

### 5. 纵向 fallback

当满足任一条件时：

- `contentWidth` 小到无法合理容纳横向表格；
- 预测单元格最高行数超过 `4`；

输出每条数据记录为：

```text
字段1: 值1
字段2: 值2
────────────
字段1: 值3
字段2: 值4
```

- 标签应粗体。
- 值保留内联样式。
- 行与行之间使用适度分隔线。
- 要保证横向切换阈值固定，避免流式场景中跳变；本项目目前没有 Qwen 那种复杂 streaming table 机制，可先用完成态稳定渲染实现。

## 必须补充的测试

在 `test/ui-markdown.test.ts` 添加或修改用例：

1. 表格单元格的 `**粗体**`：可见帧不含 `**`，且 raw frame 有粗体 ANSI 或用 Ink 行为断言。
2. 表格单元格的 `` `main.js` ``：可见帧不含反引号，raw frame 包含 accent 色 ANSI（按照项目现有颜色机制断言，不要过拟合整个序列）。
3. 内联格式不计入列宽：用临界宽度的表格，验证渲染行不超过指定 `displayWidth`。
4. 中文、emoji、长路径：每行不超宽，不丢失内容。
5. 窄宽表格：断言进入纵向格式，包含标签和值，且不显示网格边框。
6. 宽表格：断言显示 `┌`, `┬`, `┐`, `│`, `└` 等网格字符。
7. 如支持对齐：为 `:---:`, `---:` 添加居中/右对齐测试。

所有 Ink view 在测试中使用 `t.after(() => view.unmount())`，以免断言失败造成测试进程挂起。可复用 `test/support/chat-ui.ts` 的 `visibleFrame()`；如果不导入它，使用 `stripVTControlCharacters`。

## 验证要求

在 `do-code` worktree 内按顺序执行：

```bash
npx tsx --test test/ui-markdown.test.ts
npm run verify:fast
npm run verify:local
npm run build:agent
```

`verify:local` 只在稳定后运行一次；若失败，诊断时只重跑失败文件。

`npm run build:agent` 会更新 worktree 的 `dist`，用于稳定 `do-code` 输出；并不会使已经运行的进程热加载，需重启。

## Git / worktree 工作流

新会话先切换工作目录：

```text
/Users/liwangping/Desktop/02_CODE_代码项目/do-code-home/do-code
```

然后创建例如 `markdown-tables` 的 worktree。不要在父目录 `do-code-home` 调用 `enter_worktree`，它不是 Git 仓库。

完成并验证后：

1. 仅提交本次表格相关文件（预期：`src/ui/markdown.tsx`、`test/ui-markdown.test.ts`，必要时 `src/ui/terminal-text.ts`）。
2. 使用简洁提交信息，例如：

```text
fix: render markdown table cells
```

3. 保留 worktree，报告分支、提交、测试结果和修改文件。
4. 不自动 merge、push、rebase 或清理 worktree。

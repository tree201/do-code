# Bad Case 本地回流

do-code 遇到 Agent、会话、Checkpoint、上下文或配置异常时，会显示一个可复制的错误 ID：

```text
错误 ID：err_20260806_ab12cd34
查看：do-code errors show err_20260806_ab12cd34
```

如果 Agent 没有抛异常、但回答或代码修改不正确，可在当前会话输入：

```text
/bug 没有运行测试就声称已经通过
```

这会主动冻结当前 Bad Case 并生成相同格式的 ID。之后只需把 ID 提供给 Codex，即可在本机运行：

```bash
do-code errors show err_20260806_ab12cd34
do-code errors list
```

日志默认保存在 `~/.local/state/do-code/errors/<error-id>.json`，权限为当前用户可读写；如果全局目录不可写，会回退到当前项目的 `.do-code/errors/`。

## 日志内容

- 错误信息与 Stack；
- do-code、Node、操作系统和进程信息；
- 工作目录、模型 ID、会话 ID 与审批模式；
- 最近 30 条模型消息和 150 条 Agent 事件；
- Token、工具与上下文统计；
- Git revision、status 和未提交 diff；
- Headless 运行 ID、冻结配置和产物位置。

日志仅保存在本机，不会自动上传。写入前会根据环境变量中的 API Key、Token、Secret、Password 以及常见 Authorization 格式进行脱敏。日志仍可能包含用户任务、代码和对话内容，分享完整 JSON 前应按项目敏感性检查。

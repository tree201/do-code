# do-code Headless 协议 v1

`do-code` 在 stdin 非 TTY、传入任务参数或使用 `run` 子命令时进入 Headless 模式。参数任务、stdin 与 `--task-file` 都受支持；stdin 和显式任务同时存在时会按先 stdin、后显式任务合并。

```bash
do-code run --yes "修复测试" --output-format text
printf '%s\n' "修复测试" | do-code --yes --output-format json
do-code run --yes --task-file task.md --output-format stream-json
```

## 输出

- `text`：stdout 只包含最终回答，执行进度与产物目录写入 stderr。
- `json`：stdout 只包含一个 JSON 结果对象。
- `stream-json`：stdout 每行一个 JSON 对象，顺序为 `system.init`、若干 `agent.event`、`result`。

所有结构化对象均包含 `protocolVersion: 1`。`system.init.data` 是本次运行的冻结配置，不包含 API Key；`result.data` 包含模型 Token、步骤数、工具调用数、耗时、Patch、最终回答、停止原因和产物目录。

每次运行还会写入 `run-config.json`、`events.jsonl`、`agent-result.json` 和 `patch.diff`；外部自动化可消费同一份版本化 Agent 事件。

## 退出码

| 退出码 | 含义 |
| ---: | --- |
| 0 | 成功 |
| 1 | 未分类运行错误 |
| 2 | 参数或输入错误 |
| 3 | 模型配置或模型请求错误 |
| 4 | 不可恢复的工具错误（协议保留） |
| 5 | 超过最大步骤 |
| 6 | 超过整轮时间预算 |
| 130 | SIGINT 或调用方中断 |

Shell 中普通的非零退出属于 Agent 可观察、可修复的工具结果，不会立即结束整轮；不可恢复的工具基础设施错误才使用退出码 4。

CI 和外部评测器建议使用 `--yes --output-format stream-json`，固定 `--cwd`、`--max-steps` 与 `--timeout`，并保存 stdout、stderr 和产物目录。

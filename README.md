<div align="center">

# do-code

**Open source coding agent.**

Read code, edit files, run commands, and verify results in your terminal and workspace.

[![CI](https://github.com/tree201/do-code/actions/workflows/ci.yml/badge.svg)](https://github.com/tree201/do-code/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-20.19%2B%20%7C%2022.12%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

[English](README.md) | [中文](README.zh-CN.md) | [日本語](README.ja-JP.md) | [한국어](README.ko-KR.md) | [Español](README.es-ES.md) | [Français](README.fr-FR.md)

[Quick start](#installation) · [Docs](docs/README.md) · [Contributing](CONTRIBUTING.md) · [Security](SECURITY.md)

</div>

<p align="center">
  <img src="assets/terminal-preview.png" alt="do-code terminal preview" width="100%">
</p>

---

## Installation

Node.js `20.19+` or `22.12+` is required.

Run from source:

```bash
git clone https://github.com/tree201/do-code.git
cd do-code
npm install
npm run build:agent
npm link
```

Then start in an existing project:

```bash
cd /path/to/your-project
do-code auth
do-code
```

`do-code auth` guides you through provider setup. API keys are stored only in local user configuration; environment variables override saved values.

> [!NOTE]
> Install the npm package with `npm install -g @tree201/do-code`. For first use, start in a Git repository and use the default permission mode.

## What it does

- **Works in real repositories** — read and attach files, edit code, run shell commands, inspect Git diffs, and run tests.
- **Uses your model provider** — built-in setup for Volcengine Ark, Alibaba ModelStudio, DeepSeek, MiniMax, Z.AI, and ModelScope; Custom Provider supports OpenAI-compatible, Anthropic, and Gemini APIs.
- **Keeps execution controlled** — planning and permission modes are independent, and built-in file edits and patches receive local checkpoints for inspection or recovery.

Type `/` to browse commands and `@` to attach workspace files:

```text
/plan · /permissions · /model · /resume
/status · /stats · /compact · /diff
/memory · /rewind · /export · /language
@src/app.ts           Add a file to the current context
!npm test             Run a command under the current permission mode
```

Use `/thinking` and `/effort` to tune reasoning during a session; add `--persist` to save the choice as the default for future sessions. The interface supports English, Simplified Chinese, Japanese, Korean, Spanish, and French through `--language` or `/language`.

## Run it your way

### Interactive terminal

```bash
do-code
do-code --continue
do-code resume <session-id>
```

### Sessions and context

Continue the latest project session with `do-code --continue`, or choose one with `resume` and `/resume`:

```bash
do-code sessions list
do-code sessions search "authentication"
do-code sessions rename <session-id> "Auth cleanup"
do-code sessions delete <session-id>
do-code sessions export <session-id> md ./session.md
```

Use `/stats` to inspect context use and `/compact` to compact it on demand. Near the context limit, do-code compacts automatically while retaining important paths, commands, decisions, and verification state.

### Project instructions and isolation

Layered `AGENTS.md` instructions follow the workspace hierarchy; inspect or reload them with `/memory`. Start an isolated Git worktree with `do-code --worktree` or `do-code --worktree=<name>`, and inspect do-code worktrees with `do-code worktrees`.

### Profiles and extensions

Agent profiles can select a model, approval mode, instructions, step limit, and tool allow/deny lists. Inspect them with `do-code agents` and select one with `do-code --agent <name>`. Browse Markdown commands and skills with `/extensions`; use `do-code extensions` for a summary of commands, skills, and configured MCP servers.

### Scripts and CI

`run` produces stable JSON or JSONL output for automation. Tasks can come from an argument or `--task-file`; `--max-steps` and `--timeout` set execution budgets. `--artifact-dir` stores the frozen configuration, event stream, result, and patch artifacts.

```bash
do-code run --yes --output-format stream-json \
  --task-file task.txt --artifact-dir ./artifacts \
  --max-steps 40 --timeout 600
```

Use `do-code acp` for the ACP standard input/output protocol. See the [Headless / JSONL protocol](docs/headless-protocol.md) for the supported automation contract.

### Image input

Attach up to four PNG, JPEG, GIF, or WebP images with repeated `--image` in headless mode. The selected model must support image input.

```bash
do-code run --image screenshots/bug.png --image screenshots/diagram.webp "Describe these images"
```

In the interactive TUI, press Ctrl+V to paste an image from the system clipboard, or type `@path/to/image.png` to add one from a file. To remove a pending attachment, place the cursor on its image tag/token in the editor and press Backspace. Each image is limited to 10 MB and the prompt total is limited to 20 MB. Imported files are copied to `~/.local/share/do-code/projects/<project-key>/sessions/<session-id>/attachments/`; persisted messages contain only relative references such as `attachments/image_xxx.png`, never Base64 data or the original absolute path. Set `DO_CODE_DATA_DIR` to override the global data root. Existing project-local `.do-code` data is migrated to the user-managed project directory when the project is next accessed.

### Useful CLI commands

```bash
do-code config show          # Inspect effective model configuration
do-code doctor               # Check model, workspace, and local tools
do-code sessions list        # List project sessions
do-code extensions           # Inspect commands, skills, and MCP configuration
do-code agents               # List agent profiles
do-code worktrees            # List isolated worktrees
do-code errors list          # List recent error reports
```

## Safety and data

The default **Ask** mode requests confirmation for high-risk actions. **Auto** handles ordinary workspace changes automatically. **Full Access** is intended only for trusted workspaces or CI.

Configuration is stored under `~/.config/do-code/`; project sessions, attachments, checkpoints, and error reports are stored under `~/.local/share/do-code/projects/<project-key>/`. `DO_CODE_DATA_DIR` overrides the data root. Credentials and project data stay on your machine by default.

Sandbox settings can use local execution, macOS Seatbelt, or a container, depending on configuration and host support. Permission mode and sandbox configuration are separate controls.

To inspect a failure:

```bash
do-code errors list
do-code errors show <error-id>
```

## Documentation

- [Documentation index](docs/README.md)
- [Bad case feedback and diagnostics](docs/bad-case-feedback.md)
- [Headless / JSONL protocol](docs/headless-protocol.md)
- [Architecture](docs/architecture.md)
- [Local development](docs/local-development.md)
- [Personal release process](docs/releasing.md)

## Contributing

Issues and pull requests are welcome. Please read the [contributing guide](CONTRIBUTING.md) and [security policy](SECURITY.md) before submitting a change.

```bash
npm run verify:local
npm run build:agent
```

## License

[Apache-2.0](LICENSE)

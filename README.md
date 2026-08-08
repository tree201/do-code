<div align="center">

# do-code

**Open source coding agent.**

Read code, edit files, run commands, and verify results in your terminal and workspace.

[![CI](https://github.com/tree201/do-code/actions/workflows/ci.yml/badge.svg)](https://github.com/tree201/do-code/actions/workflows/ci.yml)
[![Node.js](https://img.shields.io/badge/node-20.19%2B%20%7C%2022.12%2B-339933?logo=node.js&logoColor=white)](https://nodejs.org/)
[![License](https://img.shields.io/badge/license-Apache--2.0-blue.svg)](LICENSE)

[English](README.md) | [简体中文](README.zh-CN.md)

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
- **Uses your model provider** — built-in setup for Ark, Bailian, DeepSeek, MiniMax, Z.AI, and ModelScope, plus OpenAI-compatible, Anthropic, and Gemini services.
- **Keeps execution controlled** — planning and permission modes are independent, and every edit gets a local checkpoint for inspection or recovery.

Type `/` to browse commands and `@` to attach workspace files:

```text
/plan                 Explore and propose a plan in read-only mode
/permissions          Choose Ask / Auto / Full Access
/model                 View or switch model presets
/resume                Restore a previous session
@src/app.ts           Add a file to the current context
!npm test             Run a command under the current permission mode
```

## Run it your way

### Interactive terminal

```bash
do-code
do-code --continue
do-code resume <session-id>
```

### Scripts and CI

`run` produces stable JSON or JSONL output for automation:

```bash
do-code run --yes --output-format stream-json "Fix the failing test and verify it"
```

Use `do-code acp` for the ACP standard input/output protocol. See the [Headless / JSONL protocol](docs/headless-protocol.md).

## Safety and data

The default **Ask** mode requests confirmation for high-risk actions. **Auto** handles ordinary workspace changes automatically. **Full Access** is intended only for trusted workspaces or CI.

Sessions, checkpoints, error reports, and credentials stay on your machine by default. To inspect a failure:

```bash
do-code errors list
do-code errors show <error-id>
```

## Documentation

- [Documentation index](docs/README.md)
- [Bad case feedback and diagnostics](docs/bad-case-feedback.md)
- [Headless / JSONL protocol](docs/headless-protocol.md)
- [Architecture](docs/architecture.md)
- [Personal release process](docs/releasing.md)

## Contributing

Issues and pull requests are welcome. Please read the [contributing guide](CONTRIBUTING.md) and [security policy](SECURITY.md) before submitting a change.

```bash
npm test
npm run typecheck
npm run build
```

## License

[Apache-2.0](LICENSE)

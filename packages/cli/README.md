# do-code

do-code is an open-source terminal coding agent. It works inside an existing
repository and supports multiple Chinese and international model providers.

## Install

Node.js 20.19+ or 22.12+ is required.

```bash
npm install -g do-code
do-code auth
cd /path/to/project
do-code
```

The installed launcher pins the active Node runtime for the full CLI process
and prints a direct upgrade message if the runtime is unsupported.

## First use

`do-code auth` opens a guided provider setup for Ark, Bailian, DeepSeek,
MiniMax, Z.AI, ModelScope, OpenAI-compatible, Anthropic, and Gemini services.
Your API key is stored in local user configuration with restricted permissions;
it is not written into sessions, traces, or error reports.

```bash
do-code doctor
do-code --help
```

In chat, type `/` to browse commands and `@` to attach workspace files. Use
`/resume` to continue a prior session, `/language zh` or `/language en` to
switch language, and `/bug` to create a redacted local error report.

## Safe automation

The default permission mode asks before risky operations. `--yes` enables full
automation for trusted workspaces and CI:

```bash
printf '%s\n' "Fix the failing test and run it" | do-code --yes --output-format stream-json
```

Use `do-code errors list` and `do-code errors show <error-id>` to inspect a
failure, and `do-code sessions` to search, export, or resume project sessions.

Source code, evaluation environment, contribution guide, and security policy:
<https://github.com/tree201/do-code>

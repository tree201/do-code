# Contributing to do-code

Thanks for helping improve do-code.

## Before opening a pull request

1. Open an issue first for large features or changes to the agent policy.
2. Keep each pull request focused and include tests for behaviour changes.
3. Do not add API keys, user conversations, local artifacts, or other sensitive data.
4. Run the required checks locally:

   ```bash
   npm test
   npm run typecheck
   npm run build
   ```

## Development conventions

- TypeScript is used across the CLI, server, and web application.
- Preserve user-owned worktree changes; agent and evaluator operations must be explicit and reversible where possible.
- New provider integrations must keep credentials in local configuration or environment variables, never in source code, traces, or tests.
- Changes to agent behaviour should add a regression case under `test/`.

## Reporting bugs

For product bugs, use the GitHub bug report template and include the do-code error ID when one is available:

```bash
do-code errors show <error-id>
```

Do not report security vulnerabilities in public issues; see [SECURITY.md](SECURITY.md).

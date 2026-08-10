# do-code Agent Instructions

## Working mode

- Treat this repository as a self-hosted Coding Agent project.
- The user normally runs stable `do-code` to modify this repository and uses `do-code-dev` in another terminal to validate current TypeScript source.
- Read `docs/local-development.md` before changing the local launcher, build, activation, authentication, model selection, or TUI startup flow.
- Inspect the relevant implementation and tests before editing. Prefer the smallest correct change.
- Preserve unrelated user changes. Never reset or revert files that are outside the requested task.

## Implementation and verification

- Add or update regression tests for behavior changes.
- Use layered verification to keep iteration fast without reducing coverage:
  1. While editing, run only the smallest directly relevant tests.
  2. When the behavior stabilizes, run the affected module's regression tests and `npm run verify:fast`.
  3. Before final delivery or commit, run `npm run verify:local` once as the full quality gate.
- If the full suite fails, rerun only the failing test file while diagnosing it; do not repeatedly restart the entire suite after each small fix.
- Never skip meaningful coverage, weaken assertions, suppress failures, or claim success to save time.
- For Ink tests, register `view.unmount()` with `t.after()` before assertions so failures cannot leave timers or views running. Use `visibleFrame()` for user-visible text assertions and raw frames only when testing ANSI styling.
- Source verification does not update stable `do-code`. After verified changes that the user expects to use through `do-code`, run:

  ```bash
  npm run build:agent
  ```

- For interactive TUI changes, also explain exactly how to reproduce the behavior with `do-code-dev` from a separate test workspace.
- Do not claim that a running `do-code` or `do-code-dev` process has hot-reloaded. The user must restart it to load changed source or build output.

## Stable local activation

- `do-code-dev` runs current `src/cli.ts` source and is the preferred manual validation entry.
- `do-code` runs the last compiled `dist/src/cli.js` and should remain the stable local entry.
- Do not run `npm run activate:local` before the change has passed tests, because it updates the stable local build.
- If the user explicitly asks to update, activate, install, or immediately use the verified change, run:

  ```bash
  npm run activate:local
  ```

- `npm link` is normally unnecessary after activation. Run it only when `package.json` bin entries changed, the repository moved, or the global link is missing.
- After activation, tell the user to restart any already-running `do-code` process.

## Communication

- When the user reports a bug, first state the likely root cause after inspecting the code or reproducing it, then implement the fix.
- Distinguish these states clearly:
  - Code changed but not manually verified.
  - Verified with automated tests.
  - Verified manually through `do-code-dev`.
  - Activated into stable local `do-code`.
- Never expose API keys, credential file contents, or secrets in output, tests, logs, or error messages.

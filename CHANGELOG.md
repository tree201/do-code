# Changelog

All notable changes to do-code are documented here. The project follows [Semantic Versioning](https://semver.org/).

## Unreleased

- Render inline and display LaTeX math with terminal-safe Unicode through Markdansi.
- Improve public documentation and release automation.

## 0.3.7 - 2026-08-14

- Add managed durable memory for cross-project user and per-project knowledge.
- Suggest follow-up prompts after each assistant response.
- Expand markdown table columns to use available terminal width before truncating.
- Preserve history navigation when a recalled slash command triggers completion.
- Move the task note from the workspace root to do-code's managed project data directory so it no longer pollutes the repository. Legacy `TASK.md` files are migrated automatically on first read.
- Highlight historical image labels correctly.

## 0.3.6 — 2026-08-14

- Keep recent coding work intact during context compaction with a rolling summary and a bounded queue of complete task turns.
- Reduce compaction requests by compacting older turns in batches and returning the active context to a lower watermark.
- Let long-running work use an optional `TASK.md` note for the current goal, progress, evidence, blockers, and next step; refresh it before each model request.

## 0.3.5 — 2026-08-12

- Keep queued prompts with the composer so they stay visible and can be recalled while another task runs.
- Fold large pasted text into a compact composer preview instead of displacing the input surface.
- Render terminal Markdown with display-width-safe wrapping for long inline code, URLs, unspaced CJK text, and emoji.
- Persist the approval mode per session and add the left-hand `Ctrl+G` shortcut for changing it.

## 0.3.0 — Public Beta

- Interactive terminal Coding Agent with sessions, file context, planning, approvals, checkpoints, context compaction, error reports, and Chinese/English UI.
- Guided setup for Chinese and international model providers.
- Headless execution, JSON/JSONL output, ACP integration, worktrees, and agent profiles.
- Local browser evaluation platform with datasets, runs, artifacts, hidden verification, and Bad Case feedback.

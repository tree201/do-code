# Changelog

All notable changes to do-code are documented here. The project follows [Semantic Versioning](https://semver.org/).

## Unreleased

- Improve public documentation and release automation.

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

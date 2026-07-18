# OpenAI Build Week 2026

This document separates HammaDev's pre-event baseline from improvements made
during the July 18–20, 2026 Build Week sprint. It is an engineering log, not a
claim that the existing project was created during the event.

## Baseline before Build Week

The repository entered the sprint at `b18b6e7` (July 14, 2026). It already had:

- local discovery and normalization for Codex, Claude Code, and Grok sessions;
- project-scoped Codex and Claude session selection using a shared resumability
  score, including rejection of Hamma self-handoff sessions;
- a universal task-state and handoff format with completed/remaining work,
  verification summaries, risks, referenced files, Git status, and diff stat;
- atomic local artifact writes, best-effort redaction, session size limits,
  traversal and symlink protections, and machine-readable CLI modes;
- agent skills for handoff, same-agent resume, and snapshot workflows.

The main missing product workflow was automatic selection across source agents:
users still had to know whether to run `claude:project`, `codex:project`, or
`grok:project`.

## Build Week work

### Day 1 — intelligent continuation

- Implemented `hamma continue --to <agent>` to rank project sessions across
  supported source agents, exclude the destination source by default, explain
  the decision, and create the normal handoff package.
- Implemented Grok project selection using the existing shared quality
  scorer instead of newest-session-only selection.

## Architectural decisions

- Reuse `scoreSession` and `rankCandidates`; do not introduce a competing
  cross-agent ranking formula.
- Keep native parsing inside adapters. Cross-agent orchestration consumes only
  normalized `SessionCandidate` and `HammaSession` values.
- Make explain/dry-run read-only and keep JSON stdout free of human logs.

## Codex contributions

- Repository and Git-history audit identifying the existing project-aware
  ranking, state extraction, handoff, and safety boundaries.
- Cross-agent continuation orchestration, shared Grok ranking, dry-run JSON UX,
  and focused unit/CLI tests.

## Verification log

- Baseline commands attempted July 18: `pnpm typecheck`, `pnpm test`,
  `pnpm build`, and `pnpm smoke:cli`.
- Environment result: commands did not start because this shell initially had
  Node 18.19.1, no pnpm/Corepack, and no installed dependencies. This is not
  recorded as a passing or failing repository baseline.
- After provisioning the pinned toolchain locally: TypeScript typecheck passed,
  build and compiled CLI smoke passed, and 199 tests passed across 32 files.
- `graphify update .` was attempted after the code change, but the `graphify`
  executable is not installed in this environment and no graph output exists.

## Demo flow (target)

```bash
cd /path/to/project
hamma continue --to codex --explain
hamma continue --to codex
```

The first command should show the winning source session and selection signals
without writing artifacts. The second should create the handoff and print the
exact Codex continuation command.

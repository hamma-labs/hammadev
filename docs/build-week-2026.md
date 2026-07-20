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

### Day 1 — versioned Git snapshot and drift detection

- Added a compact Git snapshot to `state.json`: HEAD, branch/detached state,
  staged, unstaged, and untracked file lists, changed-file and referenced-file
  digests, and a deterministic metadata fingerprint.
- Added `hamma show <task-id> --check-drift` plus structured `--json` output.
  Comparisons explain HEAD, branch, working-tree, untracked-file, and relevant
  file differences without storing source contents or full diffs.
- Git drift matters because a handoff is historical context: another agent may
  commit, switch branches, or edit task-relevant files before the receiving
  agent loads it. The live repository remains authoritative.

### Day 1 — evidence provenance

- Added additive provenance-tagged evidence to `state.json`, distinguishing
  source-agent claims, verification commands, repository snapshots, other tool
  observations, and narrow user confirmations.
- Explicit command exit codes produce passed/failed evidence. Commands without
  an outcome remain observed, and assistant prose is never promoted above
  claimed evidence.
- Added a compact provenance summary to `handoff.md` while retaining the
  existing verification strings for schema-v1 consumers.

### Day 2 — explainable handoff readiness

- Added deterministic readiness levels: `ready`, `review_recommended`, and
  `not_ready`. No numeric score is used because the available signals support
  categorical safety decisions more honestly than probability-like precision.
- Readiness evaluates actionability, evidence quality, verification outcomes,
  repository snapshot and live drift, risk/blocker clarity, and context
  completeness. Failed verification, blocked work, and ambiguous or missing
  continuation state are critical overrides.
- Added `hamma show <task-id> --readiness [--json]`. New handoff results and
  `state.json` also include an additive readiness-at-creation result; live
  `show` assessments are recomputed against the current repository.
- Evidence provenance made readiness possible: assistant claims can now be
  treated differently from passed commands, repository observations, tool
  evidence, and user confirmation.

Readiness is a deterministic heuristic to help a developer decide whether to
continue or review a handoff. It is not a probability, a guarantee of agent
success, or a substitute for inspecting the repository. Older handoffs without
provenance or snapshots are assessed conservatively rather than rejected.

### Day 3 — context-efficiency benchmarking

- Added `hamma benchmark <task-id|latest> [--json]` to compare normalized
  source-session content with the exact artifact bytes the receiving-agent
  contract asks an agent to load.
- Defined **effective continuation context** as only `handoff.md`: the bounded
  file the receiving-agent contract asks an agent to load initially.
- Reports `state.json` separately as optional supporting context. It is
  available for structured inspection but is not preloaded by the default
  continuation command.
- Reports `session.json`, `timeline.md`, `commands.md`,
  `redaction-report.md`, and `tool_history.jsonl` separately as archive-only
  local artifacts. They remain useful for inspection and debugging but are
  excluded from the initial-context total.
- Bumped only the benchmark report schema to version 2 because moving artifacts
  between initial, supporting, and archive categories changes the meaning of
  its machine-readable totals. Handoff and task-state schemas remain version 1.
- Added deterministic estimated-token metrics using `ceil(UTF-8 bytes / 4)`.
  These are explicitly cross-agent size estimates, not OpenAI, Claude, Grok, or
  any other provider's exact tokenizer result.

The source denominator is the UTF-8 byte sum of normalized message content plus
normalized shell command and output content. It intentionally excludes JSON
formatting and session metadata, avoiding an artificially favorable comparison.
If the continuation artifacts are larger than a small source session, HammaDev
reports a negative reduction and labels the package larger.

### Context-amplification correction

- A real local continuation test showed that the prior execution contract
  incorrectly required an agent to preload `tool_history.jsonl`. The observed
  file was 8.67 MB and represented 99.74% of the instructed continuation
  bytes; approximately 6.01 MB was embedded base64 image data. The generated
  continuation was larger than the normalized source and the target agent
  spent 7m 8s reconciling a task that was already complete. These are local
  artifact and elapsed-time measurements, not claims about provider billing or
  exact tokenizer usage.
- Changed the default contract, suggested commands, named-memory resumes, and
  packaged skills to load only `handoff.md` initially. `state.json` is
  supporting context on demand, and raw tool history is never described as
  restored native tool state or a provider cache.
- Added a deterministic 8 KiB hard ceiling for initial continuation context,
  with a 6 KiB target. Machine-readable handoff and memory-resume results expose
  the measured initial-context budget.
- Retained `tool_history.jsonl` only for backward-compatible local diagnostics.
  New archives omit base64/data URLs and control bytes, cap commands at 1 KiB,
  cap outputs at 2 KiB, cap the whole archive at 32 KiB, preserve the newest
  records, and record omissions in a metadata line.
- Quickstart now recommends `hamma continue --to <agent> --explain` so source
  selection is inspected before a handoff is created.

### Current-task epoch and no-op continuation correction

- A replay of the local release session showed a second source of wasted work:
  whole-session extraction selected an old task number, an earlier progress
  message, and a resolved publishing blocker even though the final release was
  complete. The corrected reconstruction produced one completed task, no next
  action, no unresolved risk, and `shouldCreateHandoff: false`.
- Task extraction now starts at the latest substantive user objective. Bare
  `continue`/`resume` messages and short confirmations such as `done` remain in
  that epoch without replacing its goal. Timestamped command evidence is scoped
  to the same epoch.
- Ordinary numbered release reports are no longer treated as task ledgers.
  Numbered items remain supported beneath explicit plan, task, todo, or
  remaining-work headings.
- A terminal assistant result takes precedence over stale remaining-task text
  in the current epoch. Explicit success can also clear an earlier matching
  build or publishing risk.
- `hamma continue` now performs state reconstruction and readiness assessment
  before writing artifacts. Completed, blocked, ambiguous, and not-ready states
  return a structured preflight with a recommendation and no handoff. `--force`
  is an explicit inspection escape hatch, not an automatic-resume override.
- Direct handoff creation and named-memory resume use the same outcome gate.
  Their JSON results expose `outcome` or `resumeAllowed`, and completed state
  receives a no-continuation command instead of launching another agent.
- The sanitized regression fixture preserves the failure shape without copying
  native session contents, credentials, or real user paths. The three packaged
  skills were updated and validated so their model-driven workflows honor the
  same preflight.
- Verification: 39 test files and 268 tests passed; TypeScript typecheck, build,
  packaged CLI smoke, skill validation, and `git diff --check` passed. Feature
  commit: `5a06ccc` (`fix: scope handoffs to current task epoch`).
- Added an installed-package release gate after the correction. It runs
  `npm pack`, installs that tarball and its declared runtime dependencies in an
  isolated temporary prefix, then drives the installed `hamma` binary against
  synthetic Claude session data and a temporary Git repository. It also checks
  that workspace-only source, tests, `AGENTS.md`, and local diagnostic evidence
  are absent from the publish allowlist.
- The representative package smoke measured a 1,944,181-byte tarball. Its
  completed flow created no `.hamma` directory; its actionable flow produced a
  3,190-byte `handoff.md`, remained within the 8 KiB hard ceiling, kept bounded
  tool history archive-only, and emitted a command that loads only the handoff.
  These are artifact-size measurements, not provider-token or latency claims.
  Release-gate commit: `3847362` (`test: add installed package continuation
  smoke`).

### Black-box handoff skill correction

- A real Claude Code invocation of the packaged `hamma-handoff` skill confirmed
  that the bounded-context contract was being followed: Claude initially read
  only a 3,803-byte `handoff.md` and did not preload the 10 MB local
  `session.json` archive or bounded tool-history diagnostics.
- That run still took 3 minutes 48 seconds because the source agent's explicit
  result, “npm publishing is now fully automated and verified,” was not covered
  by terminal-completion detection. Hamma incorrectly retained the earlier user
  request as an actionable next step, so Claude had to reconcile Git history and
  discover that the work was already complete.
- Terminal outcome detection now recognizes explicit implemented, automated,
  configured, fixed, resolved, and verified results for task-like subjects.
  Existing unresolved-work language still overrides those completion phrases.
  Replaying the archived normalized session now returns `completed`,
  `shouldCreateHandoff: false`, no next action, and creates no new artifact.
- Added `hamma continue --compact-json`, a transcript-free, one-line response
  intended for agent skills. It includes the selected source identity and
  quality signals, preflight outcome and readiness warnings, recommendation,
  and only the handoff fields required to locate and load the bounded artifact.
  Lists and free-form status text are capped. Existing `--json` output remains
  unchanged for backward compatibility.
- The packaged `hamma-handoff` skill now uses the compact response for both
  selection preflight and handoff creation, while still loading only
  `handoff.md` as initial continuation context.
- Verification: 39 test files and 272 tests passed; TypeScript typecheck, build,
  compiled CLI help smoke, installed-package smoke, and `git diff --check`
  passed. The package smoke measured a 1,947,146-byte tarball, withheld the
  completed flow, kept the compact response below 4 KiB on one line, and
  generated a 3,166-byte actionable handoff. These are artifact and CLI-output
  measurements, not provider-token or latency guarantees. Fix commits:
  `a754502` (`fix: recognize verified automation completion`) and `dcb1967`
  (`fix: compact agent continuation responses`).
- Released the corrections as `hammadev@0.1.0-alpha.7` from release commit
  `5568857` and annotated tag `v0.1.0-alpha.7`. [CI run
  29695489074](https://github.com/xayrullonematov/hammadev/actions/runs/29695489074)
  passed the Node 22.12 and Node 24 matrices, including packed-package and
  website browser tests. [Trusted publish run
  29695551940](https://github.com/xayrullonematov/hammadev/actions/runs/29695551940)
  passed every OIDC release gate. Registry verification showed `alpha` at
  `0.1.0-alpha.7`, exposed SLSA provenance, and a clean-directory npm execution
  printed `0.1.0-alpha.7`.

### Same-agent resume preflight correction

- A subsequent real `/hamma-resume` run loaded only one bounded handoff but
  still took 3 minutes 29 seconds to conclude that an earlier skill-installation
  task was already complete. The trace contained no Hamma network request: the
  exact 58,225-byte Claude session parsed locally in 0.18 seconds, while the
  handoff write phase took approximately 0.13 seconds. The delay was caused by
  sequential model/tool rounds after stale state reconstruction, not local
  Hamma processing.
- The resume skill had not inherited alpha.7's cross-agent compact preflight.
  It called `hamma handoff <agent>:previous --json`, created an artifact, read
  the brief, and then asked the receiving model to reconcile an incorrect
  remaining action.
- Added read-only explicit-session preflight with
  `hamma handoff <target> --to <agent> --preflight --compact-json`. Existing
  handoff JSON remains backward compatible. `/hamma-resume` now runs this
  compact preflight first and stops without creating or reading a handoff when
  the prior task is completed, blocked, ambiguous, or otherwise withheld.
- Installation requests are now substantive task instructions, and explicit
  “skills are now available/installed” results are terminal completion signals.
  Remaining, failed, or next-step language still overrides completion.
- Claude normalization now retains redacted, 4,096-character-capped Bash
  command metadata as tool evidence. Thinking blocks, tool-result contents,
  `Read` payloads, and other tool inputs remain excluded from normalized
  messages and evidence archives.
- Replaying the exact normalized failure now returns `completed`, no next
  action, and `shouldCreateHandoff: false`; the task-directory count remains
  unchanged. The compiled preflight completed in 0.31 seconds and emitted 771
  bytes on one line. These measurements isolate local CLI behavior and do not
  predict Claude, Codex, or Grok model latency.
- Verification: 39 test files and 277 tests passed; TypeScript typecheck, build,
  compiled CLI help, installed-package smoke, and `git diff --check` passed.
  The packed alpha.7 development artifact measured 1,949,262 bytes, its
  explicit completed-session preflight created no handoff, and its actionable
  flow retained a 3,166-byte initial context.
- Feature commits: `202536b` (`feat: retain redacted Claude command evidence`)
  and `2028232` (`fix: preflight same-agent resumes`).
- Released the correction as `hammadev@0.1.0-alpha.8` from release commit
  `e077144` and annotated tag `v0.1.0-alpha.8`. [CI run
  29696922600](https://github.com/xayrullonematov/hammadev/actions/runs/29696922600)
  passed the Node 22.12 and Node 24 matrices, including packed-package and
  website browser tests. [Trusted publish run
  29696996022](https://github.com/xayrullonematov/hammadev/actions/runs/29696996022)
  passed immutable identity validation, the collision guard, and npm OIDC
  publishing. Registry verification showed `alpha` at `0.1.0-alpha.8`, exposed
  an SLSA provenance attestation, and a clean temporary-cache execution printed
  `0.1.0-alpha.8`. The locally packed release artifact measured 1,950,185 bytes.
- Added `.github/workflows/publish.yml` for npm Trusted Publishing. Matching
  version tags now trigger a fail-closed Node 24 job that re-verifies the
  release and packed artifact, refuses existing registry versions, and publishes
  through short-lived GitHub OIDC credentials with automatic provenance. No
  `NPM_TOKEN` is stored. Prereleases intentionally update `alpha`; stable
  versions update `latest`, because npm OIDC does not authorize a separate
  `npm dist-tag` command. Automation commit: `dbd110c`.
- Configured the one-time npm trust relationship and exercised the recovery
  dispatch for the already-created `v0.1.0-alpha.6` tag. [GitHub Actions run
  29693448521](https://github.com/xayrullonematov/hammadev/actions/runs/29693448521)
  completed the OIDC release in 51 seconds with every validation and publish
  step passing. Registry verification showed `alpha` at `0.1.0-alpha.6`, a
  clean registry-backed CLI execution printed `0.1.0-alpha.6`, and npm exposed
  an SLSA provenance attestation. `latest` intentionally remains alpha.5 under
  the documented prerelease distribution-tag policy.

### Day 3 — persistent named project memory

- Added a stable Hamma-owned identity for long-running development threads:
  `hamma memory start`, `sync`, `list`, `show`, and `resume`.
- Stored compact immutable revisions under `.hamma/memories/<name>/revisions/`
  with `HammaTaskState`, a guarded handoff, tool history, source metadata, Git
  snapshot, readiness, and parent-revision drift. Full transcripts are not
  copied into named-memory revisions.
- Reused project-aware session discovery and quality filtering. Automatic sync
  refuses stale-only candidates and equally recent candidates from different
  agents; `--source` is available for an intentional exact selection.
- Added an active project pointer, atomic manifest/revision writes, a
  per-memory synchronization lock, duplicate-content no-ops, conservative task
  merging, and warnings instead of silently discarding conflicting task IDs.
- Extended `hamma-snap` and `hamma-resume` with named-memory workflows and
  documented opt-in lifecycle-hook recipes. Skills remain advisory and native
  sessions are never renamed or modified.

The hook investigation found stable command hooks in current Codex, including
`PreCompact` and model-visible `SessionStart`, but no documented Codex
`SessionEnd`; `Stop` is turn-scoped.
Claude Code and Grok document `PreCompact` and `SessionEnd`. Hooks still depend
on installation, project trust, a live process, and a parseable source session,
so the honest fallback remains skill-driven or explicit `hamma memory sync`.

The Codex reliability layer therefore uses `hamma codex` as a transparent
process wrapper. Native `SessionStart` binds an opaque launch record to the
exact Codex session, wrapper exit checkpoints that session, and a later trusted
agent startup retries records left behind by an interrupted wrapper. This
avoids full transcript parsing on every turn-scoped `Stop` event.
Codex's separate experimental memory feature is agent-local background memory,
not a stable cross-agent project-thread identity.

## Architectural decisions

- Reuse `scoreSession` and `rankCandidates`; do not introduce a competing
  cross-agent ranking formula.
- Keep native parsing inside adapters. Cross-agent orchestration consumes only
  normalized `SessionCandidate` and `HammaSession` values.
- Make explain/dry-run read-only and keep JSON stdout free of human logs.
- Keep the outer handoff schema at version 1 by adding an optional versioned
  `repoState.snapshot`. Handoffs created before this field existed remain
  readable and report that recorded repository metadata is unavailable.
- Build the fingerprint from safe, sorted Git metadata and file digests. It is
  a deterministic comparison aid, not cryptographic proof of repository
  identity or history.
- Allow readiness blockers to override otherwise strong signals. Repository
  drift produces explainable review warnings instead of being hidden inside a
  combined score.
- Benchmark the actual receiving-agent loading contract, not every file stored
  locally. Use normalized content rather than native agent files so old source
  paths are never reopened and existing session-path boundaries are not
  bypassed.
- Keep token estimation dependency-free and provider-neutral. Percentages are
  computed without clamping, and zero-byte or unavailable source metrics yield
  an unavailable percentage rather than invented savings.
- Keep named memory as a revisioned view of the existing `HammaTaskState`, not
  a second task schema. The original goal and compatible completed work survive
  agent switches; current session state, evidence, Git snapshot, drift, and
  readiness are recomputed for each revision.
- Prefer lifecycle hooks only as optional checkpoints. Do not install hooks or
  mutate agent configuration automatically, do not sync on every tool call,
  and do not claim zero-touch updates when trust, crashes, and active writes can
  prevent them.

## Codex contributions

- Repository and Git-history audit identifying the existing project-aware
  ranking, state extraction, handoff, and safety boundaries.
- Cross-agent continuation orchestration, shared Grok ranking, dry-run JSON UX,
  and focused unit/CLI tests.
- Git snapshot data model, deterministic comparison, drift rendering, tolerant
  old-handoff reads, synthetic Git repositories, and CLI integration tests.
- Evidence taxonomy, conservative command-outcome extraction, repository/tool/
  user evidence handling, compatibility-preserving rendering, and focused tests.
- Readiness dimensions, categorical override rules, live drift integration,
  old-handoff tolerance, stable JSON output, and deterministic test coverage.
- Effective-versus-archive artifact classification, transparent source-content
  measurement, honest reduction math, dependency-free token estimates, stable
  benchmark JSON, and generated-package/CLI test coverage.
- Cross-agent lifecycle capability investigation, immutable named-memory
  storage, conservative state merging, source conflict protection, native-hook
  event bridging, skill guidance, and synthetic multi-revision CLI tests.

## Verification log

- Baseline commands attempted July 18: `pnpm typecheck`, `pnpm test`,
  `pnpm build`, and `pnpm smoke:cli`.
- Environment result: commands did not start because this shell initially had
  Node 18.19.1, no pnpm/Corepack, and no installed dependencies. This is not
  recorded as a passing or failing repository baseline.
- After provisioning the pinned toolchain locally: TypeScript typecheck passed,
  build and compiled CLI smoke passed, and 199 tests passed across 32 files.
- Git snapshot milestone: targeted drift tests passed (32 tests across 4 files),
  full typecheck passed, the full suite passed (210 tests across 33 files), build
  passed, compiled CLI smoke passed, and `git diff --check` passed.
- Evidence provenance milestone: 31 targeted tests across 3 files passed, full
  typecheck passed, the full suite passed (215 tests across 34 files), build and
  compiled CLI smoke passed, and `git diff --check` passed.
- Readiness milestone: 44 targeted tests across 4 files passed, full typecheck
  passed, the full suite passed (232 tests across 35 files), build and compiled
  CLI smoke passed, and `git diff --check` passed.
- Context-efficiency milestone: 11 dedicated benchmark tests plus generated
  handoff integration coverage passed; full typecheck passed, the full suite
  passed (244 tests across 37 files), build and compiled CLI smoke passed, and
  `git diff --check` passed.
- Named-memory milestone: 11 focused storage, merge, hook, and end-to-end CLI
  tests passed; full typecheck passed, the full suite passed (255 tests across
  39 files), build and compiled CLI smoke passed, and `git diff --check` passed.
- Context-amplification correction: 46 focused handoff, benchmark, memory,
  quickstart, and state tests passed. Full typecheck passed, all 259 tests
  across 39 files passed, build and compiled CLI smoke passed, all three
  packaged skills validated, and `git diff --check` passed.
- Same-agent resume release: full typecheck and build passed, all 277 tests
  across 39 files passed, the isolated alpha.8 package smoke passed, the
  website production build passed, all 9 Chromium end-to-end tests passed, and
  `git diff --check` passed. GitHub CI repeated the full matrix on Node 22.12
  and Node 24 before the release tag was created.
- Reclassifying the captured local diagnostic case under the corrected contract
  measures 8,576,648 bytes of normalized source content and 5,400 bytes of
  initial continuation context: a 99.94% byte reduction. Its 17,062-byte
  `state.json` is reported as optional supporting context, while the legacy
  8.67 MB tool-history artifact is reported honestly as archive-only. Newly
  generated tool-history archives cannot exceed 32 KiB. This measurement does
  not model provider billing, prompt caching, or exact tokenization.
- Re-rendering that session through the new archival policy produced 31,549
  bytes, retained the newest 27 of 405 records, and contained neither data URLs
  nor base64-like runs of 256 characters. This archive remains excluded from
  initial continuation context.
- `graphify update .` was attempted after the code change, but the `graphify`
  executable is not installed in this environment and no graph output exists.

## Build Week commits

- `cd58f0a` — `feat: add intelligent cross-agent continuation`
- `97b8079` — `feat: detect repository drift in handoffs`
- `bf62f75` — `feat: add evidence provenance to handoffs`
- `2364711` — `feat: assess handoff readiness`
- `cc3b828` — `feat: benchmark handoff context efficiency`
- `1439b2e` — `feat: add persistent named project memory`
- `dab3fcc` — `fix: activate named memory on resume`
- `08dc30e` — `fix: bound continuation context`
- `5a06ccc` — `fix: scope handoffs to current task epoch`
- `3847362` — `test: add installed package continuation smoke`
- `dbd110c` — `ci: automate npm publishing with OIDC`
- `9748d10` — `chore: prepare 0.1.0-alpha.6`
- `0104f44` — `docs: document trusted npm releases`
- `a754502` — `fix: recognize verified automation completion`
- `dcb1967` — `fix: compact agent continuation responses`
- `5568857` — `chore: prepare 0.1.0-alpha.7`
- `202536b` — `feat: retain redacted Claude command evidence`
- `2028232` — `fix: preflight same-agent resumes`
- `e077144` — `chore: prepare 0.1.0-alpha.8`

## Demo flow (target)

```bash
cd /path/to/project
hamma continue --to codex --explain
hamma continue --to codex
hamma show latest --check-drift
hamma show latest --check-drift --json
hamma show latest --readiness
hamma show latest --check-drift --readiness --json
hamma benchmark latest
hamma benchmark latest --json
hamma memory start build-week --goal "Ship the Build Week release"
hamma memory sync --source codex:current
hamma memory show build-week
hamma memory resume build-week --to claude
```

The first command should show the winning source session, selection signals,
and current-task preflight without writing artifacts. The second creates a
handoff only when that preflight is actionable; completed work returns a no-op
instead of launching Codex. The final two commands report the size of the
effective receiving-agent context separately from local archive artifacts.
The named-memory commands demonstrate one stable Hamma-owned thread spanning
several native agent sessions while retaining evidence, Git state, readiness,
and an immutable update history.

## Named-memory limitations

- Native hooks are opt-in checkpoints, not a cross-agent delivery guarantee.
  Project trust, crashes, disabled hooks, or an actively written session can
  prevent an update.
- Automatic source selection is conservative but heuristic. When multiple
  agents are active, use `--source <agent>:<id>` to identify the intended
  session exactly.
- State merging preserves compatible completed work and evidence; it does not
  attempt a semantic three-way merge of contradictory agent narratives.
- The source fingerprint detects duplicate normalized session content. It is
  not proof of authorship, freshness, or repository identity.
- Memory artifacts remain local and may contain sensitive task text, paths,
  commands, and tool output. `.gitignore` is not access control.

## Context benchmark limitations

- Source metrics describe HammaDev's normalized message and tool content, not
  the raw native agent file or an exact model prompt.
- Artifact byte counts are exact on-disk sizes; token counts are estimates.
- The estimate does not model provider-specific tokenization, system prompts,
  caching, compression, billing, latency, or model context-window behavior.
- Optional supporting and archive artifacts are reported honestly but excluded
  from the initial-context reduction because the receiving agent is not asked
  to preload them.
- Older handoffs without a compatible normalized `session.json` remain readable,
  but source reductions are reported as unavailable.

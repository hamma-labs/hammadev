# HammaDev CLI — Friction Fix Plan

> Generated from a full codebase audit. Every issue references actual code location.

---

## Executive Summary

HammaDev has a clean core concept (save/switch/done) that works well in the guided flow. The friction concentrates in three areas:

1. **Accessibility barriers** — Node 22.12 with no graceful degradation, no version check guard
2. **Complexity leak** — Memory plumbing commands exposed to everyday users, UUID attach IDs
3. **Controversial defaults** — `manual` bootstrap mode, `both` excluding Grok, 30s ambiguity window

This plan categorizes every friction found, ranks by impact, and provides concrete code-level fixes.

---

## Friction Inventory

### P0 — Blocking / Controversial (fix immediately)

| # | Friction | Location | Impact | Proposed Fix |
|---|----------|----------|--------|-------------|
| 1 | **No early Node version guard** — users on Node 18/20 get raw crash errors | `src/cli.ts` line 1 (missing) | Blocks all users on older Node | Add CJS version gate before ESM imports |
| 2 | **`skill install` default "both" excludes Grok** — 3-agent system but default installs to 2 | `src/cli.ts` line 1984-2000 | Grok users get no skills without knowing to pass `--agent grok` | Rename "both" → "all", include grok |
| 3 | **No `.nvmrc`** — contributors and CI don't auto-switch Node version | Project root (missing) | Friction for every new contributor | Add `.nvmrc` with `22.12.0` |
| 4 | **`manual` bootstrap default is confusing** — hooks install but don't load context unless hamma-launched | `src/core/project-config.ts` | Users install hooks, expect context injection, get nothing | Change guided setup to default `automatic` (already does this in home.ts!); document the tradeoff better |

### P1 — High Impact UX (fix in next sprint)

| # | Friction | Location | Impact | Proposed Fix |
|---|----------|----------|--------|-------------|
| 5 | **Memory plumbing exposed in --help** — 13 subcommands overwhelm users | `src/cli.ts` memory command tree | Discovery paralysis | Mark plumbing commands as `.hidden()` in Commander; add `--all` to show them |
| 6 | **UUID attach IDs required for checkpoint/finish/abandon** | `src/core/memory-v2.ts`, `src/core/simple-ux.ts` | Users must copy-paste 36-char UUIDs | Auto-resolve from active memory's single open run; only require `--attach` when ambiguous |
| 7 | **No progress indication during save** — operations can take 5-15s | `src/cli.ts` line 367 | Appears hung | Add intermediate status messages or a simple activity indicator |
| 8 | **`list` command repeats nearly identical code 3× (one per agent)** | `src/cli.ts` lines 600-800 | Maintenance burden + inconsistent output | Refactor into a shared `listAgent()` helper |
| 9 | **`done` vs `save` confusion** — unclear when to use which | Help text only | Users don't close tasks, stale state accumulates | Add clarifying help text: "save = checkpoint without closing; done = checkpoint and close" |
| 10 | **30s ambiguity window is arbitrary and opaque** | `src/core/simple-ux.ts` line 24 | Users get "both X and Y recently updated" error with no explanation of why | Show timestamps + explain the 30s threshold in the error message |

### P2 — Medium Impact (fix in backlog)

| # | Friction | Location | Impact | Proposed Fix |
|---|----------|----------|--------|-------------|
| 11 | **Memory lock failure is immediate** — no retry/wait | `src/core/memory-v2.ts` lock acquisition | Hook-triggered saves conflict with manual saves | Add 3-retry with 500ms backoff before throwing |
| 12 | **Failed launch records persist forever** | `src/core/agent-launch.ts` | Disk accumulation, confusing `status` output | Add auto-cleanup of records older than 7 days |
| 13 | **Recovery runs silently** — users don't know their crashed session was saved | `src/cli.ts` bootstrap command, runtime recovery | Lost trust opportunity | Print a one-line recovery notice at session start |
| 14 | **Setup consent prompt doesn't explain what each hook does** | `src/core/home.ts` `setupSummary()` | Users approve blindly or refuse out of uncertainty | Expand summary to bullet-point each hook's purpose |
| 15 | **No `--verbose`/`--quiet` flags** | Global CLI options | No way to reduce or increase output | Add `--quiet` (suppress dim/info) and use existing `--log-level debug` for verbose |
| 16 | **`memory resume` is a confusing alias** | `src/cli.ts` memory resume command | Two commands for one action | Mark as hidden/deprecated |
| 17 | **`memory review` overlaps with `memory show`** | `src/cli.ts` memory review/show | Unclear distinction | Merge: show correction commands at the end of `show` output when state is actionable |
| 18 | **Skill install restart message doesn't handle grok** | `src/cli.ts` line ~2020 | Incorrect UI for grok users | Fix the ternary to include "Grok" case |
| 19 | **No upgrade guidance in doctor output** | `src/core/doctor.ts` | Users know they're on wrong Node but not how to fix | Add "Install Node 22+: https://nodejs.org or `nvm install 22`" |
| 20 | **Stale lock recovery has TOCTOU race** | `src/core/memory-v2.ts` lines 711-716 | Two processes detecting stale lock simultaneously → race | Use atomic lock acquisition (mkdir) immediately rather than rm-then-mkdir |

### P3 — Low Impact / Polish

| # | Friction | Location | Impact | Proposed Fix |
|---|----------|----------|--------|-------------|
| 21 | **82KB single CLI file** | `src/cli.ts` | Developer maintenance friction (not user-facing) | Extract command handlers into `src/commands/*.ts` |
| 22 | **`hamma` in non-TTY runs quickstart** — may surprise CI users | `src/cli.ts` default action | Unexpected output in scripts | Document this behavior; consider `--help`-style output instead |
| 23 | **Config get doesn't explain what the value means** | `src/cli.ts` config get handler | Shows "manual" but not what it does | Add description line (already exists in CONFIG_KEYS.describe) |
| 24 | **`hamma ask` limit defaults to 5, `memory recall` defaults to 10** | `src/cli.ts` ask vs recall handlers | Inconsistent behavior for same underlying function | Align defaults |
| 25 | **No `preinstall` script in package.json** | `package.json` | npm users silently install on wrong Node | Add engines-strict preinstall check |

---

## Controversial Design Decisions — Resolutions

### Decision 1: Bootstrap Mode Default

**Current:** `manual` — hooks install but context only loads for hamma-launched sessions.
**Problem:** Users install hooks, start an agent normally, and see no memory context. They think it's broken.
**Resolution:** Keep `manual` as the persisted default for explicit `hamma config` / `hamma setup` commands (where the user is consciously choosing), BUT the guided `hamma` interactive flow already sets `automatic` when it applies setup. This is correct behavior. The friction is that `hamma setup --apply` uses `manual` as its default — it should match the guided flow and default to `automatic`.

**Fix:** Change `src/cli.ts` setup command default from `"manual"` to `"automatic"`:
```typescript
.option("--bootstrap <mode>", "Session-start mode: manual | automatic", "automatic")
```

### Decision 2: Skill Install Agent Scope

**Current:** Default `"both"` = codex + claude only.
**Problem:** 3-agent system. Users reasonably expect "install skills" to mean "for all my agents."
**Resolution:** Rename to `"all"` and include grok. Keep individual agent targeting for users who want it.

### Decision 3: Ambiguity Window

**Current:** 30s fixed threshold. If two agents were active within 30s, refuse to auto-detect.
**Problem:** Arbitrary, not communicated to users, fails at exactly the moment power users are working fast.
**Resolution:** Keep the safety check but improve the error message to show actual timestamps and suggest the most-recently-updated agent. Allow `HAMMA_AMBIGUITY_WINDOW_MS` env override for power users.

### Decision 4: Memory Subcommand Visibility

**Current:** All 13 subcommands shown in `hamma memory --help`.
**Problem:** 8 of them are plumbing that normal users never need.
**Resolution:** Use Commander's `.hidden()` on plumbing commands. Add `hamma memory --all` to show everything. The hidden commands still work — they just don't appear in help output.

### Decision 5: Node 22.12 Requirement

**Current:** Forward-looking policy. No 22-specific APIs used in the codebase.
**Problem:** Blocks a large portion of potential users (Node 18/20 are still common).
**Resolution:** **Keep the requirement** (it's valid for beta forward-looking policy), but add proper guardrails:
- Early version check in cli.ts (before ESM import failures)
- `.nvmrc` for contributors
- Upgrade guidance in doctor output
- `preinstall` script for npm users

---

## Implementation Priority Order

### Immediate (completed)

1. ✅ Add `.nvmrc` file
2. ✅ Fix `skill install` "both" → "all" default to include grok
3. ✅ Fix skill install restart message for grok
4. ✅ Hide plumbing memory subcommands from default help
5. ✅ Improve the 30s ambiguity error message with timestamps
6. ✅ Add `config get` value description to output
7. ✅ Add early Node version guard (CJS-compatible check before ESM imports)
8. ✅ Add `preinstall` script to package.json
9. ✅ Add progress indication to save/switch/done commands
10. ✅ Add memory lock retry with backoff (3× at 500ms)
11. ✅ Auto-resolve attach IDs from active memory's single open run
12. ✅ Add upgrade guidance to doctor output
13. ✅ Mark `memory resume` as hidden (deprecated alias)
14. ✅ Add `--quiet` / `-q` global flag
15. ✅ Expand setup consent summary with hook explanations
16. ✅ Merge `memory review` into `memory show` (corrections shown when actionable)
17. ✅ Clean up stale launch records automatically (>7 days)
18. ✅ Print recovery notification at session start
19. ✅ Fix TOCTOU in stale lock recovery (retry loop pattern)
20. ✅ Refactor `list` command to shared helper
21. ✅ Change `setup --apply` default bootstrap to `automatic`
22. ✅ Scaffold `src/commands/` directory for CLI extraction

---

## Metrics to Track

- **First-run success rate**: % of users who complete `hamma` guided flow without errors
- **Version check bail-out**: % of installs that hit the Node version wall
- **Ambiguity errors**: frequency of "both X and Y" errors (should decrease as we improve messaging)
- **Memory command usage**: which memory subcommands are actually used (validate hide decisions)
- **Time-to-first-save**: how long from install to first successful `hamma save`

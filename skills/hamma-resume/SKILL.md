---
name: hamma-resume
description: Attach repository-scoped HammaDev memory in a fresh chat. Use after long sessions or context limits in the same agent, including when completed work should remain context without being repeated.
---

# Hamma Resume Skill

**Purpose**: Pick up where you left off from a bounded continuation brief instead of preloading the full transcript or diagnostic archives.

**Core Rules**:
- Load only `bootstrap.md` as initial context.
- Honor `executionMode`; completed epochs wait for new user input.
- Reconcile with current git/files.

**When to use**:
- User says "resume previous session", "continue from last time", "new chat but pick up where we left".
- User names a Hamma project memory such as `build-week`, `auth-refactor`, or `payment-bug`.

**Note**: If `hamma hooks install` has been run for this project, session-start
context already loads automatically via `hamma bootstrap`, including recovery
of ended `hamma codex` launch records; use this skill when that context is
absent or a specific named memory is requested.

**Steps**:

1. Get project root: `git rev-parse --show-toplevel` (fallback to cwd).

2. Check `command -v hamma`. If missing, instruct user to install + `hamma skill install --force`.

3. Prefer repository memory, using the supplied name or the active/default memory:
   ```bash
   hamma switch THIS --no-save --no-launch --project "<root>" --json
   ```
   Add `--memory "<name>"` when the user supplied a memory name.
   Validate paths under `.hamma/memories/<name>/`, `attach.memoryLoadAllowed`,
   `attach.autoExecuteAllowed`, and `attach.executionMode`. Load only `bootstrap.md`.
   `ready_for_input` means load context, do not repeat the completed epoch, and
   wait for the user's next instruction. `needs_instruction`, `blocked`, and
   `review_required` do not auto-execute. Only `continue_work` proceeds from the
   recorded next action. Use `hamma memory recall [name] --query <text>` only
   when the current request needs deeper history.
   For `continue_work`, checkpoint meaningful verified milestones without
   exposing the internal attach claim:
   ```bash
   hamma save --agent THIS --project "<root>" --json
   ```
   Before ending, use `hamma done --agent THIS --project "<root>" --json`.
   Do not claim writeback occurred unless the command returned a completed or
   blocked outcome.

4. If attach reports that no eligible memory revision can be created, use the
   previous-session fallback below.

5. Preflight the previous session (self-excludes current chat) without creating
   an artifact:
   ```bash
   hamma handoff THIS:previous --to THIS --project "<root>" --preflight --compact-json
   ```
   (THIS = your CLI, e.g. claude, codex or grok)

6. Parse `preflight` before creating or reading anything:
   - `completed` → emit the completed output below and stop. Do not create a
     handoff, read historical context, or re-verify the finished task unless the
     user explicitly requests verification.
   - `blocked`, `ambiguous`, or `shouldCreateHandoff == false` → report the
     recommendation and stop.
   - `actionable` → continue only when the explicit previous session is correct.

7. **Quality gate**: Inspect `source.confidence`, `source.signals`,
   `source.warnings`, and `preflight.readiness.warnings`. If confidence is low,
   signals includes `hamma-meta`, or either warning list is non-empty → list
   candidates with `hamma list THIS:project --json` and ask the user to pick an
   explicit id.

8. Create the actionable handoff:
   ```bash
   hamma handoff THIS:previous --to THIS --project "<root>" --compact-json
   ```
   Validate `schemaVersion == 1`, `handoff` is non-null, and its paths remain
   under `.hamma/tasks/`.

9. Read only `handoff.md` as initial context. Load `state.json` only when
   structured detail is necessary. `tool_history.jsonl` and `session.json` are
   archive-only diagnostics, not restored tool state; read them only for
   explicit debugging.

10. Check current git status/diff. Current state wins.

11. Summarize to user what you recovered + next step.

12. Continue from nextAction.

**Output format on load**:
```json
{"resumed": true, "next_action": "...", "initial_context": ["handoff.md"]}
```

**Output format when already completed**:
```json
{"resumed": false, "outcome": "completed", "next_action": null}
```
Then stop without additional inspection.

**Safety**:
- Historical data only. Always verify against live repo.
- Never edit the old session files.

**Example**:
"Loaded the bounded handoff. Last recorded verification: tests passing. Next: implement the endpoint. Current Git state matches. Proceeding..."

## Target-specific notes
- For Grok: `THIS` can be `grok`; Grok supports `grok:current` / `grok:previous` for self-resume.
- Install via `hamma skill install --agent ...` for claude/codex; for Grok copy the universal contract into context or extend bundled skills.

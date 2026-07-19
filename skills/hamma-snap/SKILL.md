---
name: hamma-snap
description: Snapshot the current long session into a bounded HammaDev continuation brief. Use before context limits or switching agents so the next chat can resume without preloading diagnostic archives.
---

# Hamma Snap Skill

**Purpose**: Freeze current work into a portable, bounded handoff that another chat or agent can load as its initial context.

**When to use**:
- Session is getting long.
- User says "snapshot this", "save for later", "prepare handoff before switching".

**Steps**:

1. Resolve project: `git rev-parse --show-toplevel` (or cwd).

2. Ensure `hamma` is installed via `command -v hamma`. Prompt user if missing.

3. Check whether this project has an active named memory:
   ```bash
   hamma memory show --project "<root>" --json
   ```
   If it succeeds, checkpoint *this exact session* into that memory:
   ```bash
   hamma memory sync --source THIS:current --project "<root>" --json
   ```
   Report the immutable revision id, drift warnings, and readiness. Then stop.

4. If there is no active named memory, create the existing one-off snapshot:
   ```bash
   hamma handoff THIS:current --to THIS --project "<root>" --json
   ```
   (THIS = your CLI, e.g. claude, codex, grok)

5. Parse the JSON. Confirm `handoffPath` and `statePath`.

6. Tell the user:
   - When `suggestedCommand` begins with a continuation command: "Snapshot
     created. Open a fresh chat and run: `<suggestedCommand from JSON>`"
   - When it reports no continuation is required: report that the final state
     was archived and do not recommend opening another agent.

7. **Stop here**. Do not continue the work in this chat.

**What gets created** (under .hamma/tasks/):
- `handoff.md` (the bounded initial continuation context)
- `state.json` (optional structured supporting context)
- `tool_history.jsonl` (bounded archive-only diagnostics)
- Other local archive files

**Safety**:
- Does not modify your current session files.
- The next chat should load only `handoff.md` initially.
- Skill invocation is advisory/model-driven. Native hooks or explicit
  `hamma memory sync` are required when a deterministic checkpoint is needed.

**Example response**:
"Created a bounded handoff. In a new chat, run the suggested command to load only the continuation brief."

## Target-specific notes
- Grok users can snapshot with `hamma handoff grok:current --to grok ...` and resume via the generated command or by loading files in a new Grok session.

---
name: hamma-snap
description: Snapshot the current long session into a compact HammaDev handoff + tool cache. Use before context limits or switching agents so the next chat can resume efficiently.
---

# Hamma Snap Skill

**Purpose**: Freeze your current work into a portable, token-efficient package (handoff + tool cache) that another chat or agent can load.

**When to use**:
- Session is getting long.
- User says "snapshot this", "save for later", "prepare handoff before switching".

**Steps**:

1. Resolve project: `git rev-parse --show-toplevel` (or cwd).

2. Ensure `hamma` is installed via `command -v hamma`. Prompt user if missing.

3. Create snapshot of *this* session:
   ```bash
   hamma handoff THIS:current --to THIS --project "<root>" --json
   ```
   (THIS = your CLI, e.g. claude, codex, grok)

4. Parse the JSON. Confirm `handoffPath` and `statePath`.

5. Tell the user:
   "Snapshot created. Open a fresh chat and run:
   `<suggestedCommand from JSON>`"

6. **Stop here**. Do not continue the work in this chat.

**What gets created** (under .hamma/tasks/):
- handoff.md + state.json (contract)
- tool_history.jsonl (your tool calls as cache — much better than text summary)
- Other supporting files

**Safety**:
- Does not modify your current session files.
- The cache is for the *next* chat only.

**Example response**:
"Created compact handoff with tool cache. In a new chat run the suggested command to resume exactly where we are."

## Target-specific notes
- Grok users can snapshot with `hamma handoff grok:current --to grok ...` and resume via the generated command or by loading files in a new Grok session.

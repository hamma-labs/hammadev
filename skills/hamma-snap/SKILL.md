---
name: hamma-snap
description: Persist the current session into repository-scoped HammaDev memory. Use before context limits or switching agents so durable knowledge and the current task epoch remain available.
---

# Hamma Snap Skill

**Purpose**: Persist current work as structured repository knowledge plus a bounded bootstrap that another chat or agent can load.

**When to use**:
- Session is getting long.
- User says "snapshot this", "save for later", "prepare handoff before switching".

**Steps**:

1. Resolve project: `git rev-parse --show-toplevel` (or cwd).

2. Ensure `hamma` is installed via `command -v hamma`. Prompt user if missing.

3. Save *this exact session* through the simple CLI. If no memory exists, this
   creates the reserved project memory `default`; if the session was launched
   through Hamma, it automatically checkpoints the matching attach claim:
   ```bash
   hamma save --agent THIS --project "<root>" --json
   ```
   (THIS = your CLI, e.g. claude, codex, grok.) Parse the JSON and confirm the
   operation succeeded. Do not expose or ask the user to manage internal attach
   IDs, update files, or revision paths.

4. Report the memory name, outcome, and any drift warnings. Completed work is
   still retained as context, but must not be
   presented as work to execute again.

5. **Stop here**. Do not continue the work in this chat.

**What gets created** (under `.hamma/memories/<name>/revisions/`):
- `bootstrap.md` (the bounded initial context)
- `memory-state.json` (durable knowledge and task epochs)
- `state.json` and `handoff.md` (compatibility artifacts)
- `conversation.jsonl` (sanitized user/assistant message delta)
- `tool_history.jsonl` (bounded archive-only diagnostics)

**Safety**:
- Does not modify your current session files.
- The next chat should load only `bootstrap.md` initially.
- Skill invocation is advisory/model-driven. `hamma save` is the deterministic
  checkpoint command.

**Example response**:
"Saved repository memory revision 000004. The completed epoch remains available as context and will not auto-execute."

## Target-specific notes
- Grok users can snapshot with `hamma save --agent grok` and switch with
  `hamma switch grok`.

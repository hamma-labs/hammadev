# Grok CLI Session Storage (Reverse-Engineered)

This adapter was implemented by direct analysis of how the xAI Grok TUI (v0.2.x) actually stores sessions, matching the approach used for Claude Code and Codex (cloning their source trees to observe on-disk writers).

## Sources of Truth Used
- **Official documentation** (bundled with the CLI): `~/.grok/docs/user-guide/17-sessions.md`
- **Live session artifacts** written by Grok under `~/.grok/sessions/<encoded-cwd>/<uuid>/`:
  - `summary.json` — primary metadata (id, cwd, created/updated, title, git info, counts, agent_name, session_kind)
  - `chat_history.jsonl` — raw chat messages sent to the model (type: system/user/assistant/reasoning/tool_result). Assistant entries contain `tool_calls: [{id, name, arguments}]`.
  - `updates.jsonl` — ACP-style authoritative update stream (user_message_chunk, tool_call_update with `x.ai/tool` metadata).
  - `terminal/call-*.log` — captured stdout/stderr from tool executions (especially `run_terminal_command`).
- **Binary strings** (from `~/.grok/downloads/grok-*.linux-x86_64`): internal references confirming `summary.json`, `chat_history.jsonl`, session paths, worktree handling, etc. (crate paths like `xai-grok-pager`).
- Cross-checked against claude/codex adapter implementations + their source clones for consistent extraction patterns (messages, shellCommands, project hints, redaction, resolve semantics).

## Layout (as documented + observed)
```
~/.grok/sessions/
  <urlencoded-cwd-or-slug-hash>/
    <session-id-uuidv7>/
      summary.json
      chat_history.jsonl
      updates.jsonl
      terminal/
      ...
```

GROK_HOME env / --grok-home equivalent can override (we honor `defaultGrokHome()` and pass-through).

## Auxiliary SQLite (not primary storage)
Inspection of `~/.grok` (via `find *.db *.sqlite`, `sqlite3` schema queries, and strings from the binary) shows exactly two SQLite files:

- `~/.grok/sessions/session_search.sqlite` — FTS5 (full-text search) index table `session_docs` (session_id, cwd, updated_at, title, content, content_hash). Used by the TUI session picker and `grok sessions search <keyword>`. It is a derived index, not the source of truth for messages or tool calls. (The original backgrounded inspection command surfaced this schema.)
- `~/.grok/worktrees.db` — Tracks isolated git worktrees created for sessions/forks.

**There is no `grok.db`** and no `messages` / `compactions` tables containing the conversation transcript. That was an incorrect assumption in the initial skeleton.

## Notes for Precision
- No public source repo equivalent to the claude-code / codex clones was present in /home/hamma/hdev or elsewhere on the system (confirmed via exhaustive targeted searches). The runtime data + docs + binary artifacts provide the canonical behavior.
- `grok.db` (and better-sqlite3 messages table) was an incorrect prior assumption; the real format is file-per-session JSONL + summary.
- Tool calls for the bounded archive-only `tool_history.jsonl` are best extracted from assistant tool_calls + tool_result pairing (id match) + terminal logs.
- Project scoping uses `info.cwd` / `git_root_dir` from summary + the shared `filterSessionsByProject`.
- Discover/parse deliberately use plain fs + glob + readline (no sqlite dependency) so they work even when the search index is absent or stale. This mirrors the approach in the claude and codex adapters.

This makes `grok:`, `grok:last`, `grok:project` etc. first-class alongside claude/codex.

Following the hybrid architecture, adding support for a new agent requires only an adapter that emits `HammaSession` (see this file for how we analyzed Grok's storage) plus optional minimal updates to the consumer skills layer. The core handoff model and artifacts stay universal.

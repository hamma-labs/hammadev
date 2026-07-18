# Named memory checkpoints with agent hooks

HammaDev named memories are useful without hooks:

```bash
hamma memory start build-week
hamma memory sync --source codex:current
hamma memory resume build-week --to claude
```

Hooks are an optional checkpoint layer. They do not replace explicit sync, and
they must be reviewed and trusted in each agent. HammaDev never edits native
agent sessions. Hook input is used only to select the exact current session.

## Fallback hierarchy

1. A trusted native lifecycle hook invokes `hamma memory sync --hook-agent ...`.
2. The installed `hamma-snap` skill invokes an exact `THIS:current` sync.
3. The developer runs `hamma memory sync` or supplies `--source` explicitly.

The CLI exits successfully without writing anything when a hook fires in a
project that has no active Hamma memory.

## Codex

Codex supports `PreCompact`, but does not expose a documented session-end hook.
Use `PreCompact` as the automatic safety checkpoint and explicit or skill-driven
sync for the end of a work period. Project hooks require project trust.

`.codex/hooks.json`:

```json
{
  "hooks": {
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "hamma memory sync --hook-agent codex --no-gitignore",
            "timeout": 30,
            "statusMessage": "Checkpointing active Hamma memory"
          }
        ]
      }
    ]
  }
}
```

Using `Stop` is possible but usually too noisy because Codex fires it after
each turn, not only when the interactive session closes.

## Claude Code

Claude Code supports deterministic command hooks for both `PreCompact` and
`SessionEnd`. Add the following to the single `hooks` object in a suitable
project or local settings file:

```json
{
  "hooks": {
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "hamma memory sync --hook-agent claude --no-gitignore",
            "timeout": 30
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "hamma memory sync --hook-agent claude --no-gitignore",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

## Grok Build

Grok documents `PreCompact` and `SessionEnd` hooks. Project hook files require
trust. Place a JSON hook file under `.grok/hooks/`:

```json
{
  "hooks": {
    "PreCompact": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "hamma memory sync --hook-agent grok --no-gitignore",
            "timeout": 30
          }
        ]
      }
    ],
    "SessionEnd": [
      {
        "hooks": [
          {
            "type": "command",
            "command": "hamma memory sync --hook-agent grok --no-gitignore",
            "timeout": 30
          }
        ]
      }
    ]
  }
}
```

## Operational limits

- A killed process, disabled hook, untrusted project, unavailable `hamma`
  binary, or agent crash can prevent a checkpoint.
- Hook mode writes no stdout on success so agent hook protocols do not mistake
  Hamma's result object for hook control output. Add `--json` only for manual
  diagnostics.
- HammaDev uses an atomic per-memory lock and content fingerprint so concurrent
  or duplicate updates do not silently overwrite a revision.
- Hook sync parses a session that may still be actively written. If parsing
  fails, the prior immutable revision remains current and explicit sync can be
  retried.
- Memory artifacts can contain task text, file paths, commands, and tool output.
  Keep `.hamma/` local and review it before sharing.
- Do not add `PostToolUse` synchronization for every tool call. Repeated full
  session parsing adds latency and increases race and recursion risk.

## Agent documentation used

- [Codex hooks](https://learn.chatgpt.com/docs/hooks)
- [Claude Code hooks](https://code.claude.com/docs/en/hooks)
- [Grok Build hooks](https://docs.x.ai/build/features/hooks)

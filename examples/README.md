# Synthetic demo data

Every file in this directory is fabricated for HammaDev documentation and
tests. No real Codex or Claude session content is included.

- `sessions/` contains minimal native-format JSONL examples for both agents.
- `generated/codex-to-claude/` contains the handoff package generated from the
  fake Codex session.

For normal use, run `hamma save`, `hamma switch <agent>`, `hamma done`, and
`hamma ask <question>`. Hamma hides session IDs, attach claims, update files, and
revision mechanics. Each underlying v2 revision still contains a bounded
`bootstrap.md`, durable `memory-state.json`, compatibility task artifacts, and
sanitized conversation deltas. The `hamma memory ...` commands remain available
for advanced inspection and automation.

The sample task adds a fictional `/health` endpoint. Paths point to
`/tmp/hamma-example-project` so the artifacts cannot be confused with a real
user project.

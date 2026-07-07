# Synthetic demo data

Every file in this directory is fabricated for HammaDev documentation and
tests. No real Codex or Claude session content is included.

- `sessions/` contains minimal native-format JSONL examples for both agents.
- `generated/codex-to-claude/` contains the handoff package generated from the
  fake Codex session.

The sample task adds a fictional `/health` endpoint. Paths point to
`/tmp/hamma-example-project` so the artifacts cannot be confused with a real
user project.

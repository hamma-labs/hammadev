# Threat model

## Scope and assets

HammaDev stores repository-scoped continuity under `.hamma/` and reads local
agent transcripts and hook events. Assets include source-code context, user and
agent messages, decisions, file paths, shell-command summaries, Git metadata,
and hook/configuration files.

The primary security goals are:

- do not capture a session from the wrong project or task;
- do not follow symlinks into attacker-selected locations;
- do not silently overwrite user-managed hooks or prior memory revisions;
- keep initial context bounded and keep tool history out of default bootstrap;
- redact common secrets before durable normalized artifacts are written; and
- make release identity and dependency contents auditable.

## Trust boundaries

| Boundary | Trusted assumption | Residual risk |
| --- | --- | --- |
| Local user account | Processes running as the same user can read Hamma files. | `.gitignore` prevents accidental Git inclusion; it is not access control. |
| Agent transcript | Transcript structure is parsed, but content is untrusted input. | Content can mislead semantic extraction or contain unknown secret formats. |
| Hook event | Exact session identifiers are validated and bound to launch records. | A compromised agent CLI running as the user can still emit deceptive events. |
| Repository | Canonical paths, regular-file checks, and symlink rejection protect managed targets. | Existing source files and Git metadata may themselves be malicious or misleading. |
| npm/GitHub release | Tags, package versions, OIDC provenance, registry reinstall, command contract, and SBOM are checked. | These controls do not provide reproducible builds or independent maintainer review. |

## Explicit non-goals

HammaDev does not defend against a fully compromised local account, malicious
kernel, compromised agent binary, or an attacker who can rewrite both the
repository and its Git history. Secret redaction is best effort and is not a
data-loss-prevention boundary. Memory correctness is not authority to execute
unattended actions.

## Main abuse and failure cases

1. **Cross-session capture:** exact source selection, project matching, attach
   claims, and launch records reduce accidental capture.
2. **Prompt/context injection:** known agent-context envelopes are excluded from
   task epochs; semantic regression cases measure false actionable/complete
   outcomes. Human review remains required.
3. **Path and symlink attacks:** managed roots and files are checked before use;
   unsafe symlinks are rejected.
4. **Partial writes and crashes:** temporary revisions, atomic renames, locks,
   rollback, stale-lock recovery, and retry tests protect manifest consistency.
5. **Concurrent writers:** a memory lock permits one synchronizer and rejects a
   second writer instead of merging nondeterministically.
6. **Secret persistence:** common credential formats are redacted, but unknown,
   encoded, fragmented, or domain-specific secrets can remain.
7. **Supply-chain substitution:** the publish job uses OIDC, verifies npm SLSA
   provenance, installs the exact registry version, checks its command surface,
   and ships a CycloneDX SBOM.

## Operator guidance

- Keep `.hamma/` ignored and restrict repository filesystem permissions.
- Inspect `hamma memory review` before continuing sensitive work.
- Use `hamma memory repair` or `hamma memory close` when extraction is wrong.
- Do not store production credentials in agent prompts or transcripts.
- Upgrade to the newest `hammadev@beta` after a security release.
- Treat unexpected hook changes, provenance failures, or revision corruption as
  an incident and follow [incident-response.md](incident-response.md).

# Incident response runbook

This runbook covers suspected credential exposure, malicious or incorrect hook
changes, corrupted memory, cross-project capture, and compromised releases.

## 1. Contain

1. Stop Hamma-launched agent processes for the affected repository.
2. Do not delete `.hamma/`; preserve it for analysis and restrict access to the
   affected user account.
3. Disable Hamma hooks with `hamma hooks uninstall --agent all` if hook execution
   may be involved.
4. Revoke or rotate any credential that may have appeared in a transcript or
   memory artifact. Redaction does not make an exposed credential safe.
5. For a suspected release compromise, stop installing the affected version and
   record its npm version, integrity, provenance URL, and SBOM before remediation.

## 2. Assess

- Identify affected repositories, memory names, revisions, sessions, agents,
  versions, and operating systems.
- Compare immutable revision history and Git state to determine the first bad
  capture or write.
- Inspect hook files and project configuration for non-Hamma entries before any
  uninstall or repair.
- Determine whether the event exposed data, caused unintended execution, or only
  produced incorrect reconstructed state.

Never publish real transcripts, credentials, or private repository paths in an
issue. Follow [../SECURITY.md](../SECURITY.md) for private reporting.

## 3. Eradicate and recover

- Upgrade to the fixed supported beta when available.
- Repair incorrect state with an immutable `hamma memory repair` revision, or
  close falsely actionable work with `hamma memory close`.
- Reinstall reviewed hooks and run `hamma doctor` plus `hamma setup --check`
  before resuming agent work.
- If sensitive data was durably stored, archive only the minimum evidence needed,
  then remove the affected local memory according to repository policy. Hamma
  does not currently provide selective secret erasure across immutable revisions.

## 4. Publish and learn

For a confirmed product vulnerability, publish a patched prerelease and advisory
with affected versions, impact, mitigations, and upgrade instructions. Add a
sanitized regression test, update the threat model when a trust assumption was
wrong, and record any response-process improvements.

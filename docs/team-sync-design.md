# Team Synchronization Design

## Constraint statement

Team memory synchronization is only acceptable if it is:
- **Encrypted:** Content is not readable by the transport layer or server.
- **Auditable:** Every change has an author, timestamp, and reason.
- **Conflict-safe:** Concurrent writes from different team members never silently corrupt.
- **Optional:** A team member can use Hamma without ever enabling sync.
- **Minimal:** Only structured memory (knowledge, epochs, bootstrap) syncs — never raw transcripts.

## What syncs

| Artifact | Syncs | Rationale |
| --- | --- | --- |
| Durable knowledge items | ✅ | Decisions, constraints, and facts benefit the whole team. |
| Task epoch summaries | ✅ | Knowing what's done prevents duplication. |
| Bootstrap context | ✅ | New team members get the project state immediately. |
| Memory manifest (revision list) | ✅ | Enables conflict detection. |
| Raw conversation transcripts | ❌ | Privacy, size, and sensitivity risks. |
| Session files | ❌ | Local only — contains prompts, tool output, secrets. |
| Attach claims / runtime state | ❌ | Per-machine operational state. |
| .hamma/tasks/ handoff artifacts | ❌ | Local archives only. |

## Architecture

```text
┌──────────────┐     ┌──────────────┐
│  Developer A │     │  Developer B │
│  .hamma/     │     │  .hamma/     │
│  memories/   │     │  memories/   │
│    default/  │     │    default/  │
└──────┬───────┘     └──────┬───────┘
       │  push/pull          │  push/pull
       │  (encrypted)        │  (encrypted)
       └──────────┬──────────┘
                  │
         ┌────────▼────────┐
         │  Shared remote  │
         │  (git branch,   │
         │   S3 bucket,    │
         │   or WebDAV)    │
         └─────────────────┘
```

## Sync model: CRDTs over append-only log

Each memory revision is immutable and identified by a content hash. This makes
synchronization a set-union problem:

1. **Push:** Upload any local revisions the remote doesn't have.
2. **Pull:** Download any remote revisions the local doesn't have.
3. **Merge:** Append all new revisions to the local manifest in causal order.
4. **Conflict:** Two revisions with the same parent but different content are
   both preserved (fork). The local user is asked to resolve.

Knowledge items use identity-based merge (same normalized content = same item).
Provenance from both sides is preserved. This is the same merge strategy already
used locally for cross-session knowledge deduplication.

## Encryption

**End-to-end encryption using a shared team key:**

1. On `hamma team init`, a 256-bit AES key is generated and stored in
   `~/.hamma/team-keys/<team-id>.key`.
2. The key is distributed out-of-band (team leader shares via 1Password, Slack DM, etc.).
3. Every revision pushed to the remote is encrypted with this key before upload.
4. The remote stores only ciphertext + a plaintext revision ID and parent pointer.
5. Pulling decrypts locally before merging into the memory.

**Why not per-user keys?** Per-user asymmetric keys would be more secure but
create key management complexity (revocation, rotation, n×n sharing). A shared
symmetric key is simpler for small teams and matches the threat model (same
codebase access implies trust).

## Transport backends (pluggable)

| Backend | Pros | Cons |
| --- | --- | --- |
| Git branch (`.hamma-sync`) | Already available, no new infra | Merge conflicts, size limits |
| S3 / R2 / GCS bucket | Simple, scalable, cheap | Requires cloud credentials |
| WebDAV / network share | Works on-prem | Rare in modern teams |
| Custom HTTPS API | Most control | Requires a server |

**Recommended default:** Git branch in the same repository. No new infrastructure
needed. The branch contains only encrypted revision blobs, never checked out as
working tree content.

## Commands

```bash
# Initialize team sync for this project
hamma team init --key-file ./team.key

# Push local revisions to the shared remote
hamma team push [--memory <name>]

# Pull and merge remote revisions
hamma team pull [--memory <name>]

# Show sync status (local-only, ahead, behind, diverged)
hamma team status

# Rotate the team key (re-encrypts all revisions)
hamma team rotate --new-key-file ./new-team.key
```

## Conflict resolution

When pull detects a fork (two revisions with the same parent):

1. Both revisions are stored locally.
2. Knowledge items are auto-merged (identity-based deduplication).
3. Task epoch conflicts (same epoch modified by two people) are flagged:
   ```
   ⚠ Task epoch "implement auth" has conflicting outcomes:
     Local: completed (by you, 2h ago)
     Remote: blocked (by Alice, 1h ago)
   
   Keep: [1] local / [2] remote / [3] both
   ```
4. The resolution creates a new merge revision that references both parents.

## Security considerations

- The team key must never be committed to the repository.
- Key rotation requires re-encrypting all existing remote revisions.
- A compromised key exposes all historical synced content (no forward secrecy).
- Team members can read all synced memory (no per-member access control).
- The remote is untrusted storage: only ciphertext is exposed.

## Non-goals

- Real-time collaboration (this is async push/pull, not live editing)
- Per-file or per-line locking
- Access control within a team
- Syncing to non-team-members
- Cross-repository synchronization

## Implementation phases

**Phase 1:** Manual push/pull with a local file as the "remote" (proves the merge logic).

**Phase 2:** Git-branch backend with encrypted blobs.

**Phase 3:** S3 backend for teams that don't want sync data in their repo.

**Phase 4:** Key rotation, team member management, audit log.

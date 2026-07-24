# HammaDev product overview

_Evidence refreshed 2026-07-24._

## Bottom line

HammaDev has two different current states that must not be conflated:

- **Public alpha:** `hammadev@0.1.0-alpha.10`, installed with `hammadev@alpha`.
- **Public beta:** `hammadev@0.1.0-beta.3`, installed with `hammadev@beta`.

Beta.3 keeps beta.2's one-command "Hamma for everyone" experience and adds its friction fixes: single-keypress agent selection, recovery from interrupted claims, plain-English errors, contextual next-step hints, and simplified help. Post-tag fixes on `main` add platform-specific install commands, raw-mode stdin stability, and `hamma doctor` agent checks. After installation, a user can run only `hamma`, choose an installed agent, approve one clear confirmation, and continue. Hamma performs the bootstrap, ignore, memory, claim, and launch work behind that interaction. Annotated tag `v0.1.0-beta.3` points to release commit `df4b689`; `main` is ahead with verified fixes.

- Product idea: **9/10**
- Public beta.3: **8.9/10**
- Public alpha.10: **7.8/10**
- Broad production readiness: **7/10**
- Recommendation today: **controlled early-adopter use with human review**

These scores are subjective judgments. The verification facts and limitations below matter more than the numbers.

## Repository migration status

The OpenAI Build Week deadline has ended, so the former submission repository at `xayrullonematov/hammadev` is treated as frozen. It remains referenced only where this document cites historical CI runs that actually occurred there. No future push should target that repository.

Active development has moved to [`hamma-labs/hammadev`](https://github.com/hamma-labs/hammadev). The local `origin` fetch and push URLs both point exclusively to that repository, and active package, README, issue, homepage, troubleshooting, website, and vulnerability-reporting metadata now use the organization repository.

The beta.3 release commit `df4b689` is pushed to `main` and tagged. The release was verified and published from the active organization repository.

## Public alpha.10

The previous release mismatch remains fixed for the currently advertised public version:

- npm `alpha` resolves to `0.1.0-alpha.10`.
- npm `latest` remains `0.1.0-alpha.5`.
- The supported installation command is `npm install -g hammadev@alpha`.
- A clean registry installation was checked against the shared CLI/website command contract.
- npm exposes an SLSA v1 provenance attestation for alpha.10.

The successful alpha.10 registry verification is [GitHub Actions run 29844189826](https://github.com/xayrullonematov/hammadev/actions/runs/29844189826). Final alpha.10 main-branch CI is [run 29844160028](https://github.com/xayrullonematov/hammadev/actions/runs/29844160028).

The `alpha` tag is intentionally frozen at the hackathon submission. The current documentation, website source, tests, and product contract consistently require `@beta`; `latest` remained unchanged during the beta releases.

## Released beta.2 foundations

### 1. Semantic evaluation is larger and more informative

The corpus is now versioned as `2026-07-22.1` and contains 19 cases and 19 recall queries: seven Codex, six Claude, and six Grok cases.

Its provenance is deliberately separated:

- 7 sanitized real-session derivatives, including the user-facing "next logical step" phrasing found during dogfooding.
- 12 synthetic stress cases added for adversarial, multilingual, interrupted, ambiguous, failed-command, and injected-context behavior.

The gate now reports:

- Task-state accuracy
- Next-action accuracy
- Top-three recall usefulness
- Recall mean reciprocal rank
- False-actionable rate
- False-complete rate
- Per-dimension results
- Agent, outcome, and provenance counts

Current beta.2 results are:

| Metric | Result | Gate |
| --- | ---: | ---: |
| Task-state accuracy | 1.0 | ≥ 0.95 |
| Next-action accuracy | 1.0 | ≥ 0.90 |
| Top-three recall usefulness | 1.0 | ≥ 0.90 |
| Recall MRR | 0.939 | ≥ 0.80 |
| False-actionable rate | 0 | ≤ 0.05 |
| False-complete rate | 0 | ≤ 0.05 |

This is substantially better regression coverage than six cases. It is still not a production error-rate estimate: only seven cases derive from real sessions, all labels are maintained by the project, and the synthetic cases were created with knowledge of the current heuristics.

The extractor also gained narrow Spanish and French completion, blocking, instruction, and next-action patterns. That is useful fixture coverage, not general multilingual understanding.

### 2. Cross-platform lifecycle coverage is verified

CI now defines a portable lifecycle matrix for:

- Ubuntu, macOS, and Windows
- Node 22.12 and Node 24
- All three agent launch paths
- Child exit-code preservation
- Platform-specific signal sets
- Hook installation
- Project configuration
- Launch-record persistence, binding, listing, and cleanup
- Hidden exact-session attachment metadata for Codex, Claude, and Grok
- Project paths containing spaces
- Packed npm artifact smoke

The 14-test portable lifecycle suite passed on Ubuntu, macOS, and Windows with Node 22.12 and Node 24. Both Ubuntu full-verification jobs and the Ubuntu website job also passed in run 29936983053.

Package and registry smoke now invoke both the installed Hamma CLI and npm's JavaScript entry point through Node instead of relying on platform-specific executable shims. Four resolver tests cover an explicit override, the Windows-adjacent npm layout, the Unix `lib` layout, and an actionable missing-npm failure. The packed artifact smoke passed in every lifecycle and full-verification job.

Project paths are now canonicalized without rejecting ordinary symlinked ancestors such as macOS `/var` and `/tmp`, while a symlink at the project root or inside managed memory, runtime, handoff, or hook directories remains rejected. Focused tests cover the same canonical project reached through lexical and real paths for memory, handoff, hooks, and launch records. Both macOS matrix jobs passed.

Windows uncovered a second package-smoke issue after the original SBOM gate cleared: Claude discovery relied on a synthetic home override and absolute backslash glob patterns. The final implementation honors `CLAUDE_HOME` and evaluates separator-neutral relative globs under that root. Both Windows packed-artifact jobs then passed.

### 3. Fault recovery is now explicitly testable

Memory synchronization now supports deterministic test-only fault stages around lock acquisition, revision-file completion, and revision publication. Production callers do not enable them.

Beta.2 includes coverage for:

- Simulated failure before revision publication
- Simulated failure after revision publication but before manifest update
- Exact retry after rollback
- Orphaned published revisions from a hard crash
- Partial manifest temporary files
- Stale locks owned by a dead PID
- A simultaneous second writer
- Truncated JSONL with salvageable records
- Existing exact-session retry and Linux PID-reuse behavior

The implementation now records lock ownership, preserves live locks, recovers only stale dead-owner locks, removes unreferenced revision directories, and cleans managed temporary artifacts under the synchronization lock.

All focused fault/recovery tests passed locally and in both Ubuntu full-verification jobs.

Injected exceptions are not identical to killing power at every machine instruction. Filesystem-specific durability behavior, disk-full conditions, antivirus interference, and network filesystems remain outside the evidence.

### 4. Security and release artifacts now exist

Beta.2 includes:

- A deterministic CycloneDX 1.5 production-dependency SBOM (`sbom.cdx.json`)
- SBOM freshness checking against the installed pnpm production tree
- SBOM and `SECURITY.md` inclusion in the npm package allowlist
- Packed-artifact assertions for both files
- A narrow documentation allowlist and rejection of generated audio/video media
- Registry verification that requires npm SLSA v1 provenance
- A supported-version and private vulnerability-reporting policy
- A documented vulnerability-response process
- A local-storage, transcript, hook, repository, and release threat model
- An incident-response runbook

The SBOM graph test confirms application identity, unique component references, production dependencies, no Vitest component, valid dependency edges, and the expected direct-dependency count. It does not replace validation against the official CycloneDX JSON schema or make builds reproducible.

The threat model remains candid: local same-user processes can read memory, `.gitignore` is not access control, transcript content is untrusted, redaction is best effort, and Hamma does not defend against a compromised local account or agent binary.

The hook installer now validates every existing parent directory and refuses a symlinked settings parent before writing. A focused regression verifies that a `.claude` parent cannot redirect setup output outside the project. This reduces a concrete path-boundary risk; it does not defend against a same-user process racing filesystem changes between validation and write.

### 5. The default experience is one command

The primary onboarding path is now:

```bash
npm install -g hammadev@beta
hamma
```

In an interactive terminal, bare `hamma` detects the repository, installed agents, sessions, memory, and setup state. It recommends an alternate agent where possible, presents a small picker, asks once before making changes, automatically configures the project, creates a hidden `default` memory when needed, and starts or switches the managed session. If only one agent is installed, the picker is skipped. Cancelling or declining makes no changes.

Hamma-managed launches no longer expose the raw attachment transport as a positional prompt. An authorized opaque attachment ID is registered with the child session and binds the exact launched session to the memory run. The explicit attach and no-launch forms remain available as advanced recovery paths.

Non-interactive bare `hamma` retains the read-only quickstart behavior. `hamma quickstart` remains the detailed diagnostic surface, and the explicit preview/apply workflow remains available for advanced control:

```bash
hamma setup --check
hamma setup --apply --agent detected --bootstrap manual
```

`--check` reads the environment and previews exact hook events, settings paths, bootstrap changes, and `.gitignore` coverage without creating project files. `--apply` is explicit consent to write those changes and then re-read them for verification. The existing atomic preflight, guarded replacement, and path-boundary protections remain in force.

The website consumes both installation and start commands from `product-contract.json` and now leads with `hamma`; detailed setup commands remain documented for advanced use.

## Updated scorecard

| Area | Public alpha.10 | Public beta.3 | Honest assessment |
| --- | ---: | ---: | --- |
| Product idea | 9/10 | 9/10 | Project-owned, local continuity remains a strong abstraction. |
| Feature completeness | 8.2/10 | 8.9/10 | Beta.3 retains the one-command home flow and invisible exact-session transport, with focused friction fixes. Team synchronization remains absent. |
| CLI and onboarding | 7/10 | 9.0/10 | Install, run `hamma`, press a key, press y. Errors show install commands. Still requires terminal, Git, Node, and an agent CLI. |
| Semantic task-state correctness | 7.5/10 | 8.1/10 | Metrics and stress coverage improved, but only seven labeled cases derive from real sessions. |
| Exact-session and crash mechanics | 8.5/10 | 9.1/10 | Hidden attachment binding complements explicit fault boundaries, stale-lock ownership, orphan cleanup, and concurrency tests. |
| Git and concurrency safety | 8.5/10 | 9/10 | One-writer semantics and cleanup behavior are now directly exercised. |
| Security posture | 6/10 | 7.5/10 | Policy, threat model, SBOM, incident process, and provenance checks exist. Best-effort redaction and local artifact exposure remain. |
| Release engineering | 8.5/10 | 9.2/10 | SBOM freshness, package contents, the complete CI matrix, OIDC publication, registry installation, and SLSA provenance pass. |
| Cross-platform proof | 5.5/10 | 8/10 verified | The lifecycle and packed-artifact contract passed on all three operating systems with both supported Node lines. |
| Automated testing | 9/10 | 9.2/10 | The complete local suite and both remote Ubuntu full-verification jobs passed, alongside six lifecycle jobs and the website job. |
| Team use | 3/10 | 3/10 | Memory remains intentionally local to one machine. |
| Adoption proof | 4/10 | 4/10 | No verified retention or production-use evidence was added. |

## Beta.2 release verification evidence

Established locally:

- Package identity, product contract, website, SBOM, and CLI report `0.1.0-beta.2` and use the `beta` installation channel.
- Typecheck, CLI build, website typecheck/build, SBOM regeneration/freshness, fault injection, and the 19-case semantic gate passed.
- The complete Vitest run passed 441 tests across 62 files.
- The 14-test portable lifecycle suite passed locally.
- The installed-tarball smoke passed. The final tarball measured 2,006,720 bytes and contained the beta.2 CLI contract, setup module, npm resolver, product contract, SBOM, security policy, and handoff skill while excluding source, tests, local evidence, and generated media.
- The website Chromium suite passed all nine tests.
- A real interactive-terminal dogfood run rendered the two-agent picker and cancellation exited without mutation.
- `git diff --check` passed.

Established remotely:

- Final release commit `a603750` passed all nine jobs in [CI run 29936983053](https://github.com/hamma-labs/hammadev/actions/runs/29936983053).
- Both Ubuntu full-verification jobs passed the full test, fault, semantic, SBOM, and package gates.
- All six Ubuntu/macOS/Windows lifecycle jobs passed on Node 22.12 and Node 24.
- The Ubuntu website job passed typecheck, production build, and all nine Chromium tests.
- [Publish run 29937207716](https://github.com/hamma-labs/hammadev/actions/runs/29937207716) validated tag identity and every release gate, published `hammadev@0.1.0-beta.2` through npm Trusted Publishing, waited for registry propagation, then installed and verified the exact public artifact. The complete workflow is green.
- An independent exact registry smoke installed beta.2, matched its CLI version and command contract, and verified the npm SLSA v1 attestation.
- At the time of that release, npm `beta` resolved to `0.1.0-beta.2`; `alpha` remained `0.1.0-alpha.10` and `latest` remained `0.1.0-alpha.5`.

## Beta.3 release verification evidence

Beta.3 is the current public beta. Its release commit is `df4b689`, its annotated
tag is `v0.1.0-beta.3`, and both point to the same commit on `main`.

Established locally from the release checkout:

- Typecheck and CLI build passed.
- The committed SBOM matched the installed production dependency tree.
- The 19-case semantic quality gate passed with the same 1.0 task-state,
  next-action, and recall-usefulness scores, and 0.939 recall MRR.
- The 14-test portable lifecycle suite and 13 focused fault/recovery tests passed.
- The packed-artifact smoke passed. Its tarball measured 2,027,959 bytes and
  completed the installed CLI, simple-save, and actionable-context flows.

Established remotely:

- [CI run 30103497689](https://github.com/hamma-labs/hammadev/actions/runs/30103497689)
  completed successfully for the beta.3 commit.
- [Publish run 30103497492](https://github.com/hamma-labs/hammadev/actions/runs/30103497492)
  completed successfully, verifying the release tag and publishing
  `hammadev@0.1.0-beta.3` through npm Trusted Publishing.
- npm `beta` resolves to `0.1.0-beta.3` and exposes an SLSA v1 provenance
  attestation. `alpha` remains `0.1.0-alpha.10`; `latest` was not changed.

## Post-release follow-up

1. Test the one-command interaction with people who did not build Hamma and measure where installation, terminology, consent, or agent selection still causes friction.
2. Design a GUI or native launcher only from that usability evidence; beta.3 is still one unified npm package and is not a native installer.
3. Consider promotion to `latest` separately. Do not change frozen `alpha` as part of a later promotion decision.

## Beta.3 friction fixes

A comprehensive friction audit identified 25 issues across the CLI. The following
are included in the published beta.3 release:

**Accessibility:**
- Early Node version guard before ESM imports (prevents cryptic errors on Node < 22.12).
- `preinstall` script in package.json (blocks installation on wrong Node).
- `.nvmrc` file for contributor auto-switching.
- Upgrade guidance in `hamma doctor` output (links nvm, fnm, nodejs.org).

**Command surface simplification:**
- Six plumbing memory subcommands (sync, attach, checkpoint, finish, abandon, resume) hidden from default `--help` but remain functional.
- `memory show` now includes correction commands when state is actionable (merging `memory review` behavior).
- Auto-resolve `--attach` IDs: when the memory has exactly one open run, checkpoint/finish/abandon infer it.
- Shared `printProjectCandidates()` helper deduplicates the `list` command.

**UX improvements:**
- `--quiet` / `-q` global flag suppresses informational progress messages.
- Progress indication via `onProgress` callbacks in save/switch/done commands.
- Ambiguity error shows actual timestamps and the 30s threshold.
- `hamma config get` explains what each value means, not just its name.
- `save` and `done` descriptions clarified: checkpoint-without-closing vs marks-complete.
- Setup consent prompt now bullet-points what each hook does.

**Reliability:**
- Memory lock retry: 3 attempts at 500ms exponential backoff before throwing.
- TOCTOU race in stale lock recovery fixed (retry loop instead of rm-then-mkdir).
- Stale launch records (>7 days, dead process) auto-cleaned at session start.
- Recovery notification: users see "✓ Recovered prior X session" at startup.

**Controversial design resolutions:**
- `skill install` default changed from "both" (codex+claude) to "all" (codex+claude+grok).
- `setup --apply` default bootstrap changed to `automatic` (matches guided flow).
- `src/commands/` directory scaffolded for incremental CLI extraction.

These changes are mechanical improvements. They do not change the semantic
evaluation corpus, release artifacts, or the overall product posture.

**Noob-friendly CLI:**
- Single-keypress agent selection: pressing 1/2/3 selects immediately without Enter (raw mode on TTY, readline fallback for pipes/tests).
- Auto-heal orphaned task claims: interrupted sessions no longer throw cryptic errors; Hamma abandons the stale claim and continues normally.
- Plain English error messages: removed `[CATEGORY]` prefix and troubleshooting URL; errors now show `✗ message` + "What to try" with two bullet suggestions.
- "What next?" after every action: save, done, and switch all print contextual next-step suggestions.
- Graceful switchAgent recovery: bare `hamma` catches switch failures and opens the agent fresh instead of crashing.
- Install guidance in errors: missing Git, not a git repo, and no agents found all provide exact install commands.
- Simplified help text: all command descriptions rewritten for non-technical users; help footer organized into Everyday/Launch/Troubleshooting sections.
- Program description: "Your AI coding memory — never lose work when switching between agents".

**Post-tag real-world testing fixes (on main, targeting beta.4 or tag update):**
- Raw-mode stdin fix: readline is now closed before entering raw mode and recreated after, preventing keystroke duplication and buffer leakage into subsequent prompts. Confirm prompt also uses single-keypress raw mode (y/n without Enter).
- Agent-not-installed error: `spawn ENOENT` is caught and replaced with a friendly message naming the agent and showing platform-specific install commands (brew on macOS, npm/curl on Linux).
- `hamma doctor` now reports agent availability: `codex ✓, claude ✓, grok ✗` with install hints when none are found.
- Claude session-not-found error: explains the likely cause (session too short to write a file) and suggests a workaround.
- Platform-aware install guidance: all "agent not found" errors show the correct command for the user's OS (brew/npm/curl).

## What remains before broad production use

1. Expand the real-session-derived semantic set well beyond seven cases, use blind labeling where possible, and report uncertainty rather than only pass thresholds.
2. Accumulate repeated macOS and Windows lifecycle evidence, including real agent CLI versions rather than only portable child fixtures.
3. Add process-kill, disk-full, permission-change, and filesystem-specific durability testing in disposable environments.
4. Validate the SBOM against the official CycloneDX schema and pursue reproducible or independently verifiable builds.
5. Commission a security review focused on local artifact exposure, symlink/path boundaries, transcript injection, hook trust, and secret-redaction failure.
6. Decide how immutable histories handle confirmed secret exposure; selective erasure is not currently supported.
7. Reduce or remove the Node/npm installation barrier, potentially through signed native installers or a carefully scoped desktop shell; do not split OS-specific packages unless the implementation actually needs native binaries.
8. Run onboarding usability sessions and measure setup success, warnings, correction frequency, repeated use, and retention.
9. Add team synchronization only if it can remain encrypted, auditable, conflict-safe, and optional.

## Recommendation

Public alpha.10 remains the frozen hackathon artifact. Public beta.3 is materially easier to start and has complete local, three-OS CI, npm OIDC, registry-installation, and provenance evidence.

HammaDev is still not recommended for unattended autonomous execution, sensitive enterprise repositories, regulated environments, or teams expecting shared memory.

The most accurate current description is:

> HammaDev is a well-engineered local-first continuity subsystem with a frozen hackathon alpha and a three-OS-verified public beta whose normal workflow starts with one `hamma` command. Its mechanical recovery is well tested, while native installation, semantic, security, and adoption evidence still need broader real-world proof.

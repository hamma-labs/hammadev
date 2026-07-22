# HammaDev product overview

_Evidence refreshed 2026-07-22._

## Bottom line

HammaDev has two different current states that must not be conflated:

- **Public alpha:** `hammadev@0.1.0-alpha.10`, installed with `hammadev@alpha`.
- **Local release candidate:** an unreleased `0.1.0-alpha.11` worktree containing the next reliability, security, platform, and onboarding improvements.

The alpha.11 candidate implements the five priorities from the previous review: a larger versioned semantic corpus, a three-OS lifecycle CI matrix, deterministic fault injection, security/release artifacts, and guided setup. However, it has not been committed, run through remote macOS/Windows CI, tagged, or published. Those improvements must not yet be attributed to the npm package.

- Product idea: **9/10**
- Local alpha.11 candidate: **8.5/10**
- Public alpha.10: **7.8/10**
- Broad production readiness if alpha.11 passes CI: **7/10**
- Recommendation today: **controlled early-adopter use with human review**

These scores are subjective judgments. The verification facts and limitations below matter more than the numbers.

## Public alpha.10

The previous release mismatch remains fixed for the currently advertised public version:

- npm `alpha` resolves to `0.1.0-alpha.10`.
- npm `latest` remains `0.1.0-alpha.5`.
- The supported installation command is `npm install -g hammadev@alpha`.
- A clean registry installation was checked against the shared CLI/website command contract.
- npm exposes an SLSA v1 provenance attestation for alpha.10.

The successful alpha.10 registry verification is [GitHub Actions run 29844189826](https://github.com/xayrullonematov/hammadev/actions/runs/29844189826). Final alpha.10 main-branch CI is [run 29844160028](https://github.com/xayrullonematov/hammadev/actions/runs/29844160028).

The `latest` tag intentionally remains behind because the OIDC publishing relationship authorizes `npm publish`, not a separate authenticated `npm dist-tag` operation. Documentation, the website source, tests, and the product contract now consistently require `@alpha`. Older prereleases are explicitly unsupported in `SECURITY.md`.

## Unreleased alpha.11 candidate

### 1. Semantic evaluation is larger and more informative

The corpus is now versioned as `2026-07-21.1` and contains 18 cases and 18 recall queries, balanced at six cases per agent.

Its provenance is deliberately separated:

- 6 sanitized real-session derivatives from the earlier corpus.
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

Current candidate results are:

| Metric | Result | Gate |
| --- | ---: | ---: |
| Task-state accuracy | 1.0 | ≥ 0.95 |
| Next-action accuracy | 1.0 | ≥ 0.90 |
| Top-three recall usefulness | 1.0 | ≥ 0.90 |
| Recall MRR | 0.935 | ≥ 0.80 |
| False-actionable rate | 0 | ≤ 0.05 |
| False-complete rate | 0 | ≤ 0.05 |

This is substantially better regression coverage than six cases. It is still not a production error-rate estimate: only six cases derive from real sessions, all labels are maintained by the project, and the synthetic cases were created with knowledge of the current heuristics.

The extractor also gained narrow Spanish and French completion, blocking, instruction, and next-action patterns. That is useful fixture coverage, not general multilingual understanding.

### 2. Cross-platform lifecycle coverage is configured

CI now defines a portable lifecycle matrix for:

- Ubuntu, macOS, and Windows
- Node 22.12 and Node 24
- All three agent launch paths
- Child exit-code preservation
- Platform-specific signal sets
- Hook installation
- Project configuration
- Launch-record persistence, binding, listing, and cleanup
- Project paths containing spaces
- Packed npm artifact smoke

The new portable lifecycle suite has 11 tests and passed locally on Ubuntu. The macOS and Windows jobs have **not run remotely yet**, so cross-platform proof remains configured rather than established. The full website suite remains on Ubuntu to avoid multiplying browser jobs unnecessarily.

Package and registry smoke now invoke both the installed Hamma CLI and npm's JavaScript entry point through Node instead of relying on platform-specific executable shims. Four resolver tests cover an explicit override, the Windows-adjacent npm layout, the Unix `lib` layout, and an actionable missing-npm failure. This removes a concrete `.cmd` portability risk, but the complete smoke still needs to execute on Windows CI.

Project paths are now canonicalized without rejecting ordinary symlinked ancestors such as macOS `/var` and `/tmp`, while a symlink at the project root or inside managed memory, runtime, handoff, or hook directories remains rejected. Focused tests cover the same canonical project reached through lexical and real paths for memory, handoff, hooks, and launch records. Remote macOS execution is still the authoritative platform gate.

### 3. Fault recovery is now explicitly testable

Memory synchronization now supports deterministic test-only fault stages around lock acquisition, revision-file completion, and revision publication. Production callers do not enable them.

The candidate adds coverage for:

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

Twelve focused fault/recovery tests passed before the final orphan-cleanup case was added. The final case typechecks but has not received a fresh executable test result in this environment because nested test processes were denied by the sandbox. Remote CI is still required before claiming the complete fault gate is green.

Injected exceptions are not identical to killing power at every machine instruction. Filesystem-specific durability behavior, disk-full conditions, antivirus interference, and network filesystems remain outside the evidence.

### 4. Security and release artifacts now exist

The candidate adds:

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

### 5. Setup is guided, previewable, and explicit

The candidate adds:

```bash
hamma setup --check
hamma setup --apply --agent detected --bootstrap manual
```

`--check` reads the environment and previews exact hook events, settings paths, bootstrap changes, and `.gitignore` coverage without creating project files. `--apply` is explicit consent to write those changes and then re-read them for verification.

Before applying any selected hook, setup now parses and validates every selected agent settings file. A malformed later settings file therefore stops the operation before an earlier agent hook is written. The new atomic-preflight case typechecks but still needs a process-enabled test run.

Setup supports detected agents, all agents, or a comma-separated list; manual or automatic bootstrap; Claude shared settings; and guarded `--force` replacement. It reports unsupported Node, missing Git, non-Git projects, missing selected agent binaries, hook conflicts, and ignore failures.

The built CLI was exercised on a temporary Git repository:

- Preview reported all intended changes and created no non-Git files.
- Apply wrote Claude, Codex, and Grok hook files, bootstrap configuration, and `.hamma/` ignore coverage.
- A subsequent check reported no remaining configuration changes and verified all hook files.
- Grok remained an honest readiness warning because its binary was not installed in the test environment.

The website now consumes the install command from `product-contract.json` and presents setup preview/apply as the primary onboarding path.

## Updated scorecard

| Area | Public alpha.10 | Local alpha.11 candidate | Honest assessment |
| --- | ---: | ---: | --- |
| Product idea | 9/10 | 9/10 | Project-owned, local continuity remains a strong abstraction. |
| Feature completeness | 8.2/10 | 8.8/10 | The candidate adds guided setup, platform gates, fault recovery, and security artifacts. Team synchronization remains absent. |
| CLI and onboarding | 7/10 | 8.2/10 | Preview/apply/verify is materially safer and clearer than manual hook setup. It still assumes terminal, Git, Node, and agent concepts. |
| Semantic task-state correctness | 7.5/10 | 8/10 | Metrics and stress coverage improved, but only six labeled cases derive from real sessions. |
| Exact-session and crash mechanics | 8.5/10 | 9/10 | The candidate adds explicit fault boundaries, stale-lock ownership, orphan cleanup, and concurrency tests. |
| Git and concurrency safety | 8.5/10 | 9/10 | One-writer semantics and cleanup behavior are now directly exercised. |
| Security posture | 6/10 | 7.5/10 | Policy, threat model, SBOM, incident process, and provenance checks exist. Best-effort redaction and local artifact exposure remain. |
| Release engineering | 8.5/10 | 9/10 candidate | The candidate checks SBOM freshness and registry provenance, but it has not itself passed CI or been released. |
| Cross-platform proof | 5.5/10 | 6.5/10 configured | Three-OS jobs and portable tests exist; only Ubuntu has executed locally. |
| Automated testing | 9/10 | 9/10 candidate | Coverage is broader. A complete local run was attempted but was not green because child processes are denied; the remote matrix is still pending. |
| Team use | 3/10 | 3/10 | Memory remains intentionally local to one machine. |
| Adoption proof | 4/10 | 4/10 | No verified retention or production-use evidence was added. |

## Candidate verification evidence

Established in the current environment:

- Package identity is `0.1.0-alpha.11`, preventing collision with public alpha.10.
- Vitest discovers 424 candidate tests across 60 files; discovery is not
  being counted as execution.
- TypeScript typecheck passed after the latest npm portability, setup-preflight, cleanup-scope, and canonical-path changes.
- CLI build passed after those changes.
- Website typecheck and production build passed.
- The 18-case semantic gate passed with the metrics listed above.
- A current sandbox-safe focused run passed 55 semantic, state, hook, SBOM, command-contract, and npm-resolution tests across six files.
- Four focused canonical-path tests passed across memory, handoff, hook, and launch-record behavior; one hook case overlaps the 54-test run above.
- The 11-test portable lifecycle suite passed locally on Ubuntu before the final documentation/setup adjustments.
- Twelve focused fault/recovery tests passed before the final orphan-cleanup test was added.
- The built alpha.11 CLI completed setup preview/apply/recheck behavior manually.
- The built CLI reports `0.1.0-alpha.11` and exposes the guided setup command surface.
- npm resolution found the current installation's `npm-cli.js` without invoking a shell shim.
- `npm pack --dry-run` reported 93 allowlisted entries and a 2,003,716-byte tarball containing the CLI, setup module, npm resolver, product contract, SBOM, and security policy, with no source, test, audio, video, or unrelated video-submission files.
- JSON parsing passed for package, product contract, SBOM, and semantic corpus.
- `git diff --check` passed.

Not established yet:

- A green complete Vitest run after every candidate change. The latest complete attempt, before seven later path-safety and npm-resolution tests were added, discovered 417 tests and reported 279 passed, 111 failed, and 27 skipped across 59 files. All 25 failing files depend on child processes: 101 failures contain direct sandbox `EPERM` evidence, while 10 are downstream expectation failures or timeouts after their CLI children did not start. That explains the environment result but does not make it a pass.
- Execution of the final orphan-cleanup test.
- Execution of the new multi-agent setup atomic-preflight test; its suite was stopped by `git` process denial during fixture setup.
- macOS or Windows CI success.
- A fresh SBOM byte-for-byte regeneration check; its nested `pnpm list` process is denied locally even though the SBOM structural test passes.
- The full installed-tarball smoke after the final changes; nested npm processes were denied locally by the execution sandbox.
- A successful GitHub Actions run for alpha.11.
- A commit, tag, npm publication, registry round trip, or deployed website for alpha.11.

The environment denial is not evidence of a product failure, but it is also not permission to claim the missing checks passed.

## What remains before releasing alpha.11

1. Review the worktree changes and confirm no unrelated local files are included.
2. Commit the candidate under its alpha.11 identity.
3. Push it and require the full Ubuntu suite plus all six portable OS/Node jobs to pass.
4. Confirm the package smoke includes and installs the SBOM, security policy, setup command, and exact product contract.
5. Fix any platform-specific failure rather than weakening or skipping the lifecycle assertions.
6. Create an annotated `v0.1.0-alpha.11` tag only after main CI is green.
7. Publish through the OIDC workflow and verify the exact registry artifact, SLSA provenance, and `alpha` dist-tag.
8. Update this document with the actual CI and release URLs; do not convert configured coverage into proven coverage prematurely.

## What remains before broad production use

1. Expand the real-session-derived semantic set well beyond six cases, use blind labeling where possible, and report uncertainty rather than only pass thresholds.
2. Accumulate repeated macOS and Windows lifecycle evidence, including real agent CLI versions rather than only portable child fixtures.
3. Add process-kill, disk-full, permission-change, and filesystem-specific durability testing in disposable environments.
4. Validate the SBOM against the official CycloneDX schema and pursue reproducible or independently verifiable builds.
5. Commission a security review focused on local artifact exposure, symlink/path boundaries, transcript injection, hook trust, and secret-redaction failure.
6. Decide how immutable histories handle confirmed secret exposure; selective erasure is not currently supported.
7. Run onboarding usability sessions and measure setup success, warnings, correction frequency, repeated use, and retention.
8. Add team synchronization only if it can remain encrypted, auditable, conflict-safe, and optional.

## Recommendation

Public alpha.10 remains reasonable for technically capable solo developers who inspect reconstructed state. The alpha.11 candidate is a meaningful improvement but should be described as unreleased and incompletely verified until remote CI and registry evidence exist.

HammaDev is still not recommended for unattended autonomous execution, sensitive enterprise repositories, regulated environments, or teams expecting shared memory.

The most accurate current description is:

> HammaDev is a well-engineered local-first continuity subsystem with a credible public alpha and a stronger unreleased candidate. Its mechanical recovery is increasingly well tested, while semantic, cross-platform, security, and adoption evidence still need broader real-world proof.

# HammaDev product overview

_Evidence refreshed 2026-07-22._

## Bottom line

HammaDev has two different current states that must not be conflated:

- **Public alpha:** `hammadev@0.1.0-alpha.10`, installed with `hammadev@alpha`.
- **Public beta:** `hammadev@0.1.0-beta.1`, installed with `hammadev@beta`.

Beta.1 implements the five priorities from the previous review: a larger versioned semantic corpus, a three-OS lifecycle CI matrix, deterministic fault injection, security/release artifacts, and guided setup. Release preparation and the final Windows fixes are commits `2ad31bd`, `1edc2c5`, and `3e20b2a`; annotated tag `v0.1.0-beta.1` points to final green release commit `f04d881`.

- Product idea: **9/10**
- Public beta.1: **8.8/10**
- Public alpha.10: **7.8/10**
- Broad production readiness: **7/10**
- Recommendation today: **controlled early-adopter use with human review**

These scores are subjective judgments. The verification facts and limitations below matter more than the numbers.

## Repository migration status

The OpenAI Build Week deadline has ended, so the former submission repository at `xayrullonematov/hammadev` is treated as frozen. It remains referenced only where this document cites historical CI runs that actually occurred there. No future push should target that repository.

Active development has moved to [`hamma-labs/hammadev`](https://github.com/hamma-labs/hammadev). The local `origin` fetch and push URLs both point exclusively to that repository, and active package, README, issue, homepage, troubleshooting, website, and vulnerability-reporting metadata now use the organization repository.

`main` is pushed through `3e20b2a`. The installed GitHub CLI credential remains invalid, but Git transport and the connected GitHub integration provided the push, job status, and log evidence needed to complete the CI gate.

## Public alpha.10

The previous release mismatch remains fixed for the currently advertised public version:

- npm `alpha` resolves to `0.1.0-alpha.10`.
- npm `latest` remains `0.1.0-alpha.5`.
- The supported installation command is `npm install -g hammadev@alpha`.
- A clean registry installation was checked against the shared CLI/website command contract.
- npm exposes an SLSA v1 provenance attestation for alpha.10.

The successful alpha.10 registry verification is [GitHub Actions run 29844189826](https://github.com/xayrullonematov/hammadev/actions/runs/29844189826). Final alpha.10 main-branch CI is [run 29844160028](https://github.com/xayrullonematov/hammadev/actions/runs/29844160028).

The `alpha` tag is intentionally frozen at the hackathon submission. Beta.1's documentation, website source, tests, and product contract consistently require `@beta`; `latest` remained unchanged during the release.

## Released beta.1

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

Current beta.1 results are:

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
- Project paths containing spaces
- Packed npm artifact smoke

The 11-test portable lifecycle suite passed on Ubuntu, macOS, and Windows with Node 22.12 and Node 24. Both Ubuntu full-verification jobs and the Ubuntu website job also passed in run 29931074657.

Package and registry smoke now invoke both the installed Hamma CLI and npm's JavaScript entry point through Node instead of relying on platform-specific executable shims. Four resolver tests cover an explicit override, the Windows-adjacent npm layout, the Unix `lib` layout, and an actionable missing-npm failure. The packed artifact smoke passed in every lifecycle and full-verification job.

Project paths are now canonicalized without rejecting ordinary symlinked ancestors such as macOS `/var` and `/tmp`, while a symlink at the project root or inside managed memory, runtime, handoff, or hook directories remains rejected. Focused tests cover the same canonical project reached through lexical and real paths for memory, handoff, hooks, and launch records. Both macOS matrix jobs passed.

Windows uncovered a second package-smoke issue after the original SBOM gate cleared: Claude discovery relied on a synthetic home override and absolute backslash glob patterns. The final implementation honors `CLAUDE_HOME` and evaluates separator-neutral relative globs under that root. Both Windows packed-artifact jobs then passed.

### 3. Fault recovery is now explicitly testable

Memory synchronization now supports deterministic test-only fault stages around lock acquisition, revision-file completion, and revision publication. Production callers do not enable them.

Beta.1 adds coverage for:

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

Beta.1 adds:

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

Beta.1 adds:

```bash
hamma setup --check
hamma setup --apply --agent detected --bootstrap manual
```

`--check` reads the environment and previews exact hook events, settings paths, bootstrap changes, and `.gitignore` coverage without creating project files. `--apply` is explicit consent to write those changes and then re-read them for verification.

Before applying any selected hook, setup now parses and validates every selected agent settings file. A malformed later settings file therefore stops the operation before an earlier agent hook is written. The atomic-preflight case passed in the complete local and remote test suites.

Setup supports detected agents, all agents, or a comma-separated list; manual or automatic bootstrap; Claude shared settings; and guarded `--force` replacement. It reports unsupported Node, missing Git, non-Git projects, missing selected agent binaries, hook conflicts, and ignore failures.

The built CLI was exercised on a temporary Git repository:

- Preview reported all intended changes and created no non-Git files.
- Apply wrote Claude, Codex, and Grok hook files, bootstrap configuration, and `.hamma/` ignore coverage.
- A subsequent check reported no remaining configuration changes and verified all hook files.
- Grok remained an honest readiness warning because its binary was not installed in the test environment.

The website now consumes the install command from `product-contract.json` and presents setup preview/apply as the primary onboarding path.

## Updated scorecard

| Area | Public alpha.10 | Public beta.1 | Honest assessment |
| --- | ---: | ---: | --- |
| Product idea | 9/10 | 9/10 | Project-owned, local continuity remains a strong abstraction. |
| Feature completeness | 8.2/10 | 8.8/10 | Beta.1 adds guided setup, platform gates, fault recovery, and security artifacts. Team synchronization remains absent. |
| CLI and onboarding | 7/10 | 8.2/10 | Preview/apply/verify is materially safer and clearer than manual hook setup. It still assumes terminal, Git, Node, and agent concepts. |
| Semantic task-state correctness | 7.5/10 | 8/10 | Metrics and stress coverage improved, but only six labeled cases derive from real sessions. |
| Exact-session and crash mechanics | 8.5/10 | 9/10 | Beta.1 adds explicit fault boundaries, stale-lock ownership, orphan cleanup, and concurrency tests. |
| Git and concurrency safety | 8.5/10 | 9/10 | One-writer semantics and cleanup behavior are now directly exercised. |
| Security posture | 6/10 | 7.5/10 | Policy, threat model, SBOM, incident process, and provenance checks exist. Best-effort redaction and local artifact exposure remain. |
| Release engineering | 8.5/10 | 9.2/10 | SBOM freshness, package contents, the complete CI matrix, OIDC publication, registry installation, and SLSA provenance pass. |
| Cross-platform proof | 5.5/10 | 8/10 verified | The lifecycle and packed-artifact contract passed on all three operating systems with both supported Node lines. |
| Automated testing | 9/10 | 9.2/10 | The complete local suite and both remote Ubuntu full-verification jobs passed, alongside six lifecycle jobs and the website job. |
| Team use | 3/10 | 3/10 | Memory remains intentionally local to one machine. |
| Adoption proof | 4/10 | 4/10 | No verified retention or production-use evidence was added. |

## Candidate verification evidence

Established locally:

- Package identity, product contract, website, SBOM, and CLI report `0.1.0-beta.1` and use the `beta` installation channel.
- Typecheck, CLI build, website typecheck/build, SBOM regeneration/freshness, fault injection, and the 18-case semantic gate passed.
- The complete Vitest run passed 426 tests across 60 files before the final Claude path changes; the final focused Claude path/discovery/resolve run passed 25 tests.
- The 11-test portable lifecycle suite passed locally.
- The installed-tarball smoke passed after every final path change. The final tarball measured 2,003,966 bytes and contained the CLI, setup module, npm resolver, product contract, SBOM, security policy, and handoff skill while excluding source, tests, local evidence, and generated media.
- The website Chromium suite passed all nine tests.
- `git diff --check` passed.

Established remotely:

- [`CI run 29931074657`](https://github.com/hamma-labs/hammadev/actions/runs/29931074657) passed all nine jobs.
- Final release commit `f04d881` passed all nine jobs again in [CI run 29931443146](https://github.com/hamma-labs/hammadev/actions/runs/29931443146).
- Both Ubuntu full-verification jobs passed the full test, fault, semantic, SBOM, and package gates.
- All six Ubuntu/macOS/Windows lifecycle jobs passed on Node 22.12 and Node 24.
- Both Windows packed-artifact smokes passed after the explicit Claude home and relative-glob fixes.
- The Ubuntu website job passed typecheck, production build, and all nine Chromium tests.
- [Publish run 29931762835](https://github.com/hamma-labs/hammadev/actions/runs/29931762835) validated the tag identity and every release gate, then published `hammadev@0.1.0-beta.1` through npm Trusted Publishing with signed provenance.
- A subsequent exact registry smoke installed beta.1, matched its CLI version and command contract, and verified the npm SLSA v1 attestation.
- npm `beta` resolves to `0.1.0-beta.1`; `alpha` remains `0.1.0-alpha.10` and `latest` remains `0.1.0-alpha.5`.

Release verification note:

- The publish workflow's immediate registry-install step exhausted its three-minute retry window because npm still returned `ETARGET`, so that workflow run concluded failed after publication.
- Registry propagation completed shortly afterward. The same repository command, `pnpm smoke:registry -- --version 0.1.0-beta.1`, then passed against npm with the exact version, provenance, and command surface. No republish or dist-tag mutation was performed.

## Post-release follow-up

1. Increase or diversify the registry propagation strategy before the next release so a successful publication is less likely to leave a red workflow run.
2. Re-run the failed beta.1 publish job when Actions write access is available if a green historical workflow record is desired; its collision guard will skip publication and repeat verification.
3. Consider promotion to `latest` separately. Do not change `alpha` or `latest` as part of the beta.1 release.

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

Public alpha.10 remains the frozen hackathon artifact. Public beta.1 is materially stronger and has complete local, three-OS CI, npm OIDC, registry-installation, and provenance evidence.

HammaDev is still not recommended for unattended autonomous execution, sensitive enterprise repositories, regulated environments, or teams expecting shared memory.

The most accurate current description is:

> HammaDev is a well-engineered local-first continuity subsystem with a frozen hackathon alpha and a three-OS-verified public beta. Its mechanical recovery is well tested, while semantic, security, and adoption evidence still need broader real-world proof.

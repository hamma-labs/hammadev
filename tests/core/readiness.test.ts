import { describe, expect, it } from "vitest";
import {
  compareRepositorySnapshots,
  GitRepositorySnapshot,
} from "../../src/core/git-snapshot.js";
import {
  assessHandoffReadiness,
  formatHandoffReadiness,
} from "../../src/core/readiness.js";
import { HammaTaskState } from "../../src/core/state.js";

function snapshot(
  overrides: Partial<GitRepositorySnapshot> = {}
): GitRepositorySnapshot {
  return {
    version: 1,
    available: true,
    head: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    branch: "main",
    detachedHead: false,
    stagedFiles: [],
    unstagedFiles: [],
    untrackedFiles: [],
    changedFiles: [],
    changedFileDigests: [],
    relevantFiles: [
      { path: "src/core.ts", contentHash: "blob-a" },
    ],
    fingerprint: "fingerprint-a",
    warnings: [],
    ...overrides,
  };
}

function state(
  overrides: Partial<HammaTaskState> = {}
): HammaTaskState {
  const repoSnapshot = snapshot();
  return {
    schemaVersion: 1,
    outcome: "actionable",
    nextAction: "Implement the remaining parser test.",
    goal: "Complete the parser and verify the handoff.",
    project: {
      path: "/tmp/project",
      sourceCli: "claude",
      targetCli: "codex",
      sourceSessionId: "synthetic-session",
      sourcePath: "/tmp/session.jsonl",
    },
    current: {
      nextRecommendedTask: "Implement the remaining parser test.",
    },
    tasks: [
      {
        id: "1",
        title: "Implement parser test",
        status: "remaining",
        summary: "Implement parser test",
        evidence: [],
        risks: [],
        filesMentioned: ["src/core.ts"],
      },
    ],
    verification: ["tests: command passed (exit 0)"],
    evidence: [
      {
        source: "command",
        kind: "tests",
        status: "passed",
        summary: "tests command passed",
        command: "pnpm test",
        exitCode: 0,
      },
      {
        source: "repository",
        kind: "git_snapshot",
        status: "observed",
        summary: "Git snapshot recorded",
      },
    ],
    risks: [],
    filesMentioned: ["src/core.ts"],
    repoState: { snapshot: repoSnapshot, warnings: [] },
    references: {
      fullSession: "session.json",
      timeline: "timeline.md",
      commands: "commands.md",
      redactionReport: "redaction-report.md",
    },
    ...overrides,
  };
}

function noDrift(repoSnapshot = snapshot()) {
  return compareRepositorySnapshots(repoSnapshot, repoSnapshot);
}

describe("explainable handoff readiness", () => {
  it("marks a clear actionable handoff with successful verification ready", () => {
    const input = state();
    const result = assessHandoffReadiness(
      input,
      noDrift(input.repoState.snapshot)
    );
    expect(result.level).toBe("ready");
    expect(result.blockers).toEqual([]);
    expect(result.warnings).toEqual([]);
    expect(result.signals.join(" ")).toContain("successful verification");
    expect(result.dimensions.actionability.status).toBe("strong");
  });

  it("recommends review when evidence consists mainly of agent claims", () => {
    const input = state({
      evidence: [{
        source: "agent_claim",
        kind: "tests",
        status: "claimed",
        summary: "All tests pass",
      }],
    });
    const result = assessHandoffReadiness(input, noDrift(input.repoState.snapshot));
    expect(result.level).toBe("review_recommended");
    expect(result.warnings.join(" ")).toContain("only by source-agent claims");
  });

  it("makes an unresolved failed verification command not ready", () => {
    const input = state({
      evidence: [{
        source: "command",
        kind: "tests",
        status: "failed",
        summary: "tests command failed",
        exitCode: 1,
      }],
    });
    const result = assessHandoffReadiness(input, noDrift(input.repoState.snapshot));
    expect(result.level).toBe("not_ready");
    expect(result.blockers.join(" ")).toContain("unresolved failed outcome");
    expect(result.dimensions.verification.status).toBe("critical");
  });

  it("recommends review for an unknown verification command outcome", () => {
    const input = state({
      evidence: [{
        source: "command",
        kind: "build",
        status: "observed",
        summary: "build command observed",
      }],
    });
    const result = assessHandoffReadiness(input, noDrift(input.repoState.snapshot));
    expect(result.level).toBe("review_recommended");
    expect(result.warnings.join(" ")).toContain("outcome is unknown");
  });

  it("makes a blocked outcome not ready", () => {
    const result = assessHandoffReadiness(
      state({ outcome: "blocked", nextAction: "Resolve the blocker." }),
      noDrift()
    );
    expect(result.level).toBe("not_ready");
    expect(result.blockers).toContain("The reconstructed task outcome is blocked.");
  });

  it("makes a blocked task override an otherwise actionable outcome", () => {
    const input = state();
    input.tasks.push({
      status: "blocked",
      summary: "Waiting for credentials",
      evidence: [],
      risks: [],
      filesMentioned: [],
    });
    const result = assessHandoffReadiness(input, noDrift(input.repoState.snapshot));
    expect(result.level).toBe("not_ready");
    expect(result.blockers.join(" ")).toContain("despite the actionable outcome");
  });

  it("makes ambiguous or missing next-action state not ready", () => {
    const ambiguous = assessHandoffReadiness(
      state({ outcome: "ambiguous", nextAction: undefined }),
      noDrift()
    );
    const missing = assessHandoffReadiness(
      state({ nextAction: undefined, current: {}, tasks: [] }),
      noDrift()
    );
    expect(ambiguous.level).toBe("not_ready");
    expect(missing.level).toBe("not_ready");
  });

  it("recommends review when the Git snapshot is missing", () => {
    const input = state({ repoState: { warnings: [] } });
    const result = assessHandoffReadiness(input);
    expect(result.level).toBe("review_recommended");
    expect(result.warnings).toContain("A usable Git repository snapshot is not available.");
  });

  it("recommends review when the repository comparison is unavailable", () => {
    const input = state();
    const unavailable = snapshot({ available: false, head: undefined, branch: undefined });
    const result = assessHandoffReadiness(
      input,
      compareRepositorySnapshots(input.repoState.snapshot, unavailable)
    );
    expect(result.level).toBe("review_recommended");
    expect(result.warnings).toContain("Repository drift could not be fully assessed.");
  });

  it("keeps no drift as a strong signal", () => {
    const input = state();
    const result = assessHandoffReadiness(input, noDrift(input.repoState.snapshot));
    expect(result.signals).toContain("No repository drift was detected.");
    expect(result.dimensions.repositoryConsistency.status).toBe("strong");
  });

  it("recommends review for HEAD drift", () => {
    const input = state();
    const current = snapshot({ head: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb" });
    const result = assessHandoffReadiness(
      input,
      compareRepositorySnapshots(input.repoState.snapshot, current)
    );
    expect(result.level).toBe("review_recommended");
    expect(result.warnings).toContain("Repository HEAD differs from the handoff snapshot.");
  });

  it("recommends review for relevant-file drift", () => {
    const input = state();
    const current = snapshot({
      relevantFiles: [{ path: "src/core.ts", contentHash: "blob-b" }],
    });
    const result = assessHandoffReadiness(
      input,
      compareRepositorySnapshots(input.repoState.snapshot, current)
    );
    expect(result.level).toBe("review_recommended");
    expect(result.warnings.join(" ")).toContain("handoff-referenced file digest differs");
  });

  it("tolerates old handoffs without provenance or Git snapshots", () => {
    const old = state({ evidence: [], repoState: { warnings: [] } });
    const result = assessHandoffReadiness(old);
    expect(result.level).toBe("review_recommended");
    expect(result.warnings.join(" ")).toContain("older handoff");
    expect(result.warnings.join(" ")).toContain("snapshot is not available");
  });

  it("lets a critical failure override otherwise strong signals", () => {
    const input = state();
    input.evidence.push({
      source: "command",
      kind: "typecheck",
      status: "failed",
      summary: "typecheck failed",
      exitCode: 2,
    });
    const result = assessHandoffReadiness(input, noDrift(input.repoState.snapshot));
    expect(result.signals.length).toBeGreaterThan(0);
    expect(result.level).toBe("not_ready");
  });

  it("is deterministic and renders an explainable report", () => {
    const input = state();
    const drift = noDrift(input.repoState.snapshot);
    const first = assessHandoffReadiness(input, drift);
    const second = assessHandoffReadiness(input, drift);
    expect(second).toEqual(first);
    const output = formatHandoffReadiness(first);
    expect(output).toContain("Handoff readiness: READY");
    expect(output).toContain("Strong signals");
    expect(output).toContain("Recommendation:");
  });
});

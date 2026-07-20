import { describe, expect, it } from "vitest";
import { HammaSession } from "../../src/core/schema.js";
import {
  scoreSession,
  rankCandidates,
  rankSessions,
  SessionRef,
  SessionCandidate,
} from "../../src/core/quality.js";

function session(
  userContents: string[],
  assistantContents: string[] = ["Implementation is in progress."]
): HammaSession {
  return {
    meta: { sourceCli: "codex", sourceSessionId: "s" },
    messages: [
      ...userContents.map((content) => ({ role: "user" as const, content })),
      ...assistantContents.map((content) => ({ role: "assistant" as const, content })),
    ],
    shellCommands: [],
    parserWarnings: [],
    security: { redacted: false, redactionCount: 0, warnings: [] },
  };
}

function ref(overrides: Partial<SessionRef> = {}): SessionRef {
  return {
    sourceCli: "codex",
    sessionId: "id",
    path: "/tmp/x",
    lastUpdatedAt: "2026-07-04T00:00:00Z",
    sizeBytes: 1000,
    ...overrides,
  };
}

describe("scoreSession", () => {
  it("scores substantive task work as resumable/high or medium", () => {
    const candidate = scoreSession(
      session(["Implement the parser migration in src/parser.ts."]),
      ref()
    );
    expect(candidate.resumable).toBe(true);
    expect(candidate.signals).toContain("task-instruction");
    expect(candidate.signals).toContain("file-reference");
  });

  it("flags a Hamma handoff invocation as hamma-meta and non-resumable", () => {
    const skillBody =
      "Base directory for this skill: /home/u/.claude/skills/hamma-handoff\n\n" +
      "# Hamma Handoff\n\nRecover the newest Claude Code session associated with " +
      "the current repository, validate the generated handoff, and continue the task.";
    const candidate = scoreSession(session([skillBody]), ref());
    expect(candidate.signals).toContain("hamma-meta");
    expect(candidate.resumable).toBe(false);
    expect(candidate.confidence).toBe("low");
    expect(candidate.reasons.join(" ")).toContain("Hamma handoff operation");
  });

  it("flags the $hamma-handoff sentinel as hamma-meta", () => {
    const candidate = scoreSession(session(["$hamma-handoff"]), ref());
    expect(candidate.signals).toContain("hamma-meta");
    expect(candidate.resumable).toBe(false);
  });

  it("flags generated attach transport prompts as non-resumable", () => {
    const candidate = scoreSession(session([
      "[HAMMA_ATTACH_ID:123e4567-e89b-42d3-a456-426614174000] Attach Hamma repository memory 'default'.",
    ]), ref());
    expect(candidate.signals).toContain("hamma-meta");
    expect(candidate.resumable).toBe(false);
  });

  it("does not flag ordinary work that merely mentions hamma", () => {
    const candidate = scoreSession(
      session(["Make the hamma handoff CLI bidirectional and update src/cli.ts."]),
      ref()
    );
    expect(candidate.signals).not.toContain("hamma-meta");
    expect(candidate.resumable).toBe(true);
  });
});

describe("rankCandidates", () => {
  it("prefers a higher-quality older session over a trivial fresh one", () => {
    const strongOld = scoreSession(
      session(["Refactor the auth module in src/auth.ts and add tests."]),
      ref({ sessionId: "old", lastUpdatedAt: "2026-07-01T00:00:00Z" })
    );
    const trivialNew = scoreSession(
      session(["$hamma-handoff"]),
      ref({ sessionId: "new", lastUpdatedAt: "2026-07-04T00:00:00Z" })
    );
    const ranked = rankCandidates([trivialNew, strongOld]);
    expect(ranked[0].sessionId).toBe("old");
    expect(ranked[0].resumable).toBe(true);
    expect(ranked[1].resumable).toBe(false);
  });

  it("breaks score ties by recency", () => {
    const older = scoreSession(
      session(["Fix the parser bug."]),
      ref({ sessionId: "older", lastUpdatedAt: "2026-07-01T00:00:00Z" })
    );
    const newer = scoreSession(
      session(["Fix the parser bug."]),
      ref({ sessionId: "newer", lastUpdatedAt: "2026-07-03T00:00:00Z" })
    );
    const ranked = rankCandidates([older, newer]);
    expect(ranked[0].sessionId).toBe("newer");
  });
});

describe("rankSessions", () => {
  it("assesses via a loader and marks unparsable refs non-resumable", async () => {
    const refs: SessionRef[] = [
      ref({ sessionId: "good", path: "good" }),
      ref({ sessionId: "bad", path: "bad" }),
    ];
    const ranked = await rankSessions(refs, async (r) => {
      if (r.path === "bad") throw new Error("boom");
      return session(["Implement the migration in src/x.ts with tests."]);
    });
    const good = ranked.find((c: SessionCandidate) => c.sessionId === "good");
    const bad = ranked.find((c: SessionCandidate) => c.sessionId === "bad");
    expect(good?.resumable).toBe(true);
    expect(bad?.resumable).toBe(false);
    expect(bad?.reasons.join(" ")).toContain("could not be parsed");
    expect(ranked[0].sessionId).toBe("good");
  });
});

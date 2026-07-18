import { describe, expect, it } from "vitest";
import {
  chooseContinuationCandidate,
  parseContinuationAgent,
} from "../src/continuation.js";
import { SessionCandidate } from "../src/core/quality.js";

function candidate(
  sourceCli: "codex" | "claude" | "grok",
  score: number,
  overrides: Partial<SessionCandidate> = {}
): SessionCandidate {
  return {
    sourceCli,
    sessionId: `${sourceCli}-${score}`,
    path: `/sessions/${sourceCli}-${score}`,
    lastUpdatedAt: "2026-07-18T00:00:00Z",
    sizeBytes: 100,
    score,
    confidence: "high",
    resumable: true,
    messageCount: 4,
    userMessageCount: 2,
    assistantMessageCount: 2,
    signals: ["task-instruction"],
    reasons: [],
    ...overrides,
  };
}

describe("chooseContinuationCandidate", () => {
  it("selects the strongest resumable session across source agents", () => {
    const result = chooseContinuationCandidate(
      [candidate("claude", 12), candidate("grok", 16), candidate("codex", 20)],
      "codex"
    );
    expect(result.selected.sourceCli).toBe("grok");
    expect(result.excludedSources).toEqual(["codex"]);
    expect(result.candidates.map((item) => item.sourceCli)).toEqual([
      "grok",
      "claude",
    ]);
  });

  it("skips non-resumable sessions even when they have a higher score", () => {
    const result = chooseContinuationCandidate(
      [
        candidate("claude", 99, { resumable: false, confidence: "low" }),
        candidate("grok", 8),
      ],
      "codex"
    );
    expect(result.selected.sourceCli).toBe("grok");
  });

  it("can include the destination agent for explicit same-agent continuation", () => {
    const result = chooseContinuationCandidate(
      [candidate("codex", 20), candidate("claude", 10)],
      "codex",
      true
    );
    expect(result.selected.sourceCli).toBe("codex");
    expect(result.excludedSources).toEqual([]);
  });

  it("fails clearly when no cross-agent session is resumable", () => {
    expect(() =>
      chooseContinuationCandidate([candidate("codex", 20)], "codex")
    ).toThrow("No resumable cross-agent session");
  });
});

describe("parseContinuationAgent", () => {
  it("accepts supported agents case-insensitively", () => {
    expect(parseContinuationAgent("CODEX")).toBe("codex");
  });

  it("rejects unsupported targets", () => {
    expect(() => parseContinuationAgent("other")).toThrow(
      "Unsupported continuation target"
    );
  });
});

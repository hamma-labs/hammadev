import { describe, expect, it } from "vitest";
import {
  conversationDelta,
  emptyMemoryState,
  mergeMemoryKnowledge,
  renderMemoryBootstrap,
  taskEpochId,
  validateMemoryUpdate,
} from "../../src/core/memory-state.js";
import { HammaSession } from "../../src/core/schema.js";
import { HammaTaskState } from "../../src/core/state.js";
import { classifyMemoryExecutionMode } from "../../src/core/memory.js";
import { HandoffReadinessResult } from "../../src/core/readiness.js";
import { RepositoryDriftResult } from "../../src/core/git-snapshot.js";

function session(messages: HammaSession["messages"]): HammaSession {
  return {
    meta: { sourceCli: "codex", sourceSessionId: "session-a", startedAt: "2026-01-01T00:00:00Z" },
    messages,
    shellCommands: [],
    parserWarnings: [],
    security: { redacted: true, redactionCount: 0, warnings: [] },
  };
}

function state(startMessageIndex = 0): HammaTaskState {
  return {
    schemaVersion: 1,
    outcome: "completed",
    goal: "Keep repository knowledge.",
    project: { sourceCli: "codex", targetCli: "memory", sourceSessionId: "session-a" },
    current: { taskEpoch: { startMessageIndex, messageCount: 2, basis: "latest_substantive_user" } },
    tasks: [], verification: [], evidence: [], risks: [], filesMentioned: ["src/core/memory.ts"],
    repoState: { warnings: [] },
    references: { fullSession: "", timeline: "", commands: "", redactionReport: "" },
  };
}

describe("memory v2 state", () => {
  function readiness(level: HandoffReadinessResult["level"]): HandoffReadinessResult {
    const dimension = { status: "adequate" as const, signals: [] };
    return {
      schemaVersion: 1,
      level,
      dimensions: {
        actionability: dimension, evidenceQuality: dimension, verification: dimension,
        repositoryConsistency: dimension, riskAndBlockerClarity: dimension,
        contextCompleteness: dimension,
      },
      signals: [], warnings: [], blockers: [], recommendation: "",
    };
  }

  function drift(categories: RepositoryDriftResult["categories"] = ["none"]): RepositoryDriftResult {
    const snapshot = {
      version: 1 as const, available: true, detachedHead: false,
      stagedFiles: [], unstagedFiles: [], untrackedFiles: [], changedFiles: [],
      changedFileDigests: [], relevantFiles: [], warnings: [],
    };
    return {
      schemaVersion: 1,
      detected: !categories.includes("none"),
      categories,
      recordedSnapshotAvailable: true,
      currentSnapshotAvailable: true,
      recorded: snapshot,
      current: snapshot,
      differences: { changedFiles: [], relevantFiles: [], untrackedFilesAppeared: [], untrackedFilesDisappeared: [] },
      signals: [], recommendation: "",
    };
  }

  it("strictly validates structured updates", () => {
    expect(validateMemoryUpdate({
      sessionSummary: "Implemented persistent memory.",
      decisions: [{ decision: "Use immutable revisions.", rationale: "Safe rollback.", files: ["src/core/memory.ts"] }],
    })).toMatchObject({ sessionSummary: "Implemented persistent memory." });
    expect(() => validateMemoryUpdate({ sessionSummary: "ok", surprise: true })).toThrow("unknown field");
    expect(() => validateMemoryUpdate({ decisions: [] })).toThrow("sessionSummary");
    expect(validateMemoryUpdate({ sessionSummary: "done", outcome: "completed", nextAction: null }))
      .toMatchObject({ outcome: "completed", nextAction: null });
    expect(() => validateMemoryUpdate({ sessionSummary: "done", outcome: "completed", nextAction: "repeat it" }))
      .toThrow("completed memory update");
    expect(() => validateMemoryUpdate({ sessionSummary: "done", outcome: "unknown" }))
      .toThrow("outcome must be");
  });

  it("merges normalized identities while retaining provenance", () => {
    const first = mergeMemoryKnowledge([], validateMemoryUpdate({ sessionSummary: "one", decisions: ["Use SQLite for local state."] }), {
      sourceCli: "codex", sourceSessionId: "a", revisionId: "r1", capturedAt: "2026-01-01T00:00:00Z", source: "structured_update",
    });
    const second = mergeMemoryKnowledge(first, validateMemoryUpdate({ sessionSummary: "two", decisions: ["  use sqlite for local state. "] }), {
      sourceCli: "claude", sourceSessionId: "b", revisionId: "r2", capturedAt: "2026-01-02T00:00:00Z", source: "structured_update",
    });
    expect(second).toHaveLength(1);
    expect(second[0].provenance).toHaveLength(2);
  });

  it("stores append-only deltas and falls back safely after rewrites", () => {
    const firstSession = session([
      { role: "system", content: "must not archive" },
      { role: "user", content: "Implement memory." },
      { role: "assistant", content: "Working." },
    ]);
    const first = conversationDelta(firstSession);
    expect(first.messages.map((message) => message.role)).toEqual(["user", "assistant"]);
    const appended = conversationDelta(session([...firstSession.messages, { role: "assistant", content: "Done." }]), first.cursor);
    expect(appended.rewritten).toBe(false);
    expect(appended.messages).toHaveLength(1);
    const rewritten = conversationDelta(session([{ role: "user", content: "Different history." }]), first.cursor);
    expect(rewritten.rewritten).toBe(true);
    expect(rewritten.messages).toHaveLength(1);
  });

  it("uses source session and boundary to isolate task epochs", () => {
    const source = session([]);
    expect(taskEpochId(state(0), source)).not.toBe(taskEpochId(state(8), source));
  });

  it("keeps bootstrap context bounded and prioritizes decisions", () => {
    const memory = emptyMemoryState("2026-01-01T00:00:00Z");
    memory.projectSummary = "A".repeat(3000);
    memory.knowledge = mergeMemoryKnowledge([], validateMemoryUpdate({
      sessionSummary: "done",
      decisions: Array.from({ length: 50 }, (_, index) => `Decision ${index}: ${"x".repeat(300)}`),
    }), { sourceCli: "codex", capturedAt: "2026-01-01T00:00:00Z", source: "structured_update" });
    const bootstrap = renderMemoryBootstrap("default", memory, state(), 4096);
    expect(Buffer.byteLength(bootstrap, "utf8")).toBeLessThanOrEqual(4096);
    expect(bootstrap).toContain("[decision]");
  });

  it("maps outcomes, readiness, and unsafe drift to attach execution modes", () => {
    expect(classifyMemoryExecutionMode(state(), readiness("ready"), drift())).toEqual({ mode: "ready_for_input", allowed: false });
    expect(classifyMemoryExecutionMode({ ...state(), outcome: "blocked" }, readiness("ready"), drift())).toEqual({ mode: "blocked", allowed: false });
    expect(classifyMemoryExecutionMode({ ...state(), outcome: "ambiguous" }, readiness("ready"), drift())).toEqual({ mode: "needs_instruction", allowed: false });
    expect(classifyMemoryExecutionMode({ ...state(), outcome: "actionable" }, readiness("ready"), drift())).toEqual({ mode: "continue_work", allowed: true });
    expect(classifyMemoryExecutionMode({ ...state(), outcome: "actionable" }, readiness("not_ready"), drift())).toEqual({ mode: "review_required", allowed: false });
    expect(classifyMemoryExecutionMode({ ...state(), outcome: "actionable" }, readiness("ready"), drift(["relevant_files_changed"]))).toEqual({ mode: "review_required", allowed: false });
  });
});

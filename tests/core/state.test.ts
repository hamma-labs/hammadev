import { describe, expect, it } from "vitest";
import { extractTaskState } from "../../src/core/state.js";
import { HammaMessage, HammaSession } from "../../src/core/schema.js";

function session(messages: HammaMessage[]): HammaSession {
  return {
    meta: {
      sourceCli: "claude",
      sourceSessionId: "outcome-test",
      projectPath: "/tmp/hamma-outcome-test",
    },
    messages,
    shellCommands: [],
    parserWarnings: [],
    security: {
      redacted: false,
      redactionCount: 0,
      warnings: [],
    },
  };
}

function extract(messages: HammaMessage[]) {
  return extractTaskState(session(messages), {
    targetCli: "codex",
    repoState: { warnings: [] },
  });
}

describe("handoff outcome extraction", () => {
  it("classifies a terminal status after resume as completed", () => {
    const state = extract([
      { role: "user", content: "Implement the handoff extraction improvements." },
      { role: "user", content: "resume" },
      {
        role: "assistant",
        content: "All acceptance criteria pass on the regenerated bundle. Typecheck passed with no errors.",
      },
    ]);

    expect(state.outcome).toBe("completed");
    expect(state.nextAction).toBeUndefined();
    expect(state.current.nextRecommendedTask).toBeUndefined();
  });

  it("does not turn a bare continuation instruction into actionable work", () => {
    const state = extract([
      { role: "user", content: "Build the requested feature." },
      { role: "assistant", content: "I inspected the relevant files." },
      { role: "user", content: "continue" },
    ]);

    expect(state.outcome).toBe("ambiguous");
    expect(state.nextAction).toBeUndefined();
  });

  it("preserves a concrete latest user instruction as actionable", () => {
    const state = extract([
      { role: "user", content: "Implement the remaining parser fix." },
    ]);

    expect(state.outcome).toBe("actionable");
    expect(state.nextAction).toBe("Implement the remaining parser fix.");
  });

  it("classifies a reported blocker and records its resolution action", () => {
    const state = extract([
      { role: "user", content: "resume" },
      { role: "assistant", content: "I am blocked and need user input before I can proceed." },
    ]);

    expect(state.outcome).toBe("blocked");
    expect(state.nextAction).toContain("Resolve blocker:");
  });
});

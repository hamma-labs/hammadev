import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { extractTaskState } from "../../src/core/state.js";
import { HammaMessage, HammaSession } from "../../src/core/schema.js";
import { parseCodexRollout } from "../../src/adapters/codex/rollout.js";
import { renderHandoffMarkdown } from "../../src/core/handoff.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const CODEX_FIXTURE = path.join(
  HERE,
  "..",
  "adapters",
  "codex",
  "fixtures",
  "rollout-2026-06-15T12-00-00-fixture-abc-123.jsonl"
);

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

describe("goal selection, completed varied phrasing, files context and non-empty tasks", () => {
  it("favors most recent substantive user message for goal (reduces stale pollution)", () => {
    const state = extract([
      { role: "user", content: "Early polluted goal: implement the initial parser in legacy.ts years ago" },
      { role: "assistant", content: "ok" },
      { role: "user", content: "Now update the handoff to support recent goal selection in src/core/state.ts" },
    ]);
    expect(state.goal).toContain("update the handoff");
    expect(state.goal).not.toContain("Early polluted");
  });

  it("detects completed using varied phrasing beyond exact 'Task N completed'", () => {
    const state = extract([
      { role: "user", content: "Implement task 7 for the release" },
      { role: "assistant", content: "Task 7 done and shipped. All green." },
    ]);
    const completed = state.tasks.filter(t => t.status === "completed");
    expect(completed.length).toBeGreaterThan(0);
  });

  it("produces non-empty structured tasks + actionable for substantive session lacking explicit numbered tasks", () => {
    const state = extract([
      { role: "user", content: "Please add support for health check endpoint and corresponding tests." },
      { role: "assistant", content: "Done. Typecheck passes." },
    ]);
    expect(state.tasks.length).toBeGreaterThan(0);
    expect(["actionable", "completed"]).toContain(state.outcome);
  });

  it("collects referenced files in state", () => {
    const state = extract([
      { role: "user", content: "Fix the bug in src/core/handoff.ts and update tests/core/handoff.test.ts" },
    ]);
    expect(state.filesMentioned.some((f: string) => f.includes("handoff.ts"))).toBe(true);
  });

  it("filters noise/artifacts from filesMentioned (state clean, no handoff.md etc)", () => {
    const state = extract([
      { role: "user", content: "edit src/core/foo.ts ; also see handoff.md and README.md and .github/workflows/ci.yml and troubleshooting.md" },
      { role: "assistant", content: "done with src/core/foo.ts" },
    ]);
    const noise = state.filesMentioned.filter((f: string) => /handoff|state\.json|session\.json|README|troubleshooting|\.github|ci\.yml/i.test(f) && !/\/src\//i.test(f));
    expect(noise.length).toBe(0);
    expect(state.filesMentioned.some((f: string) => f.includes("foo.ts"))).toBe(true);
  });

  it("correctly extracts titles + completed/remaining across multi-assistant sequence (stresses inlined task+title logic)", () => {
    const state = extract([
      { role: "user", content: "Start work on the release tasks." },
      { role: "assistant", content: "I am proceeding with task #3: Harden the session loader paths.\n1. Fix traversal\n2. Add size guard" },
      { role: "assistant", content: "Task 3 done. Moving to next." },
      { role: "user", content: "Next: update redact and state extraction." },
      { role: "assistant", content: "Task #4 implemented. All tests pass." },
    ]);
    const completed = state.tasks.filter((t: any) => t.status === "completed");
    const remaining = state.tasks.filter((t: any) => t.status === "remaining");
    expect(completed.length).toBeGreaterThan(0);
    // title from plan or intro should be present
    expect(state.tasks.some((t: any) => (t.title || t.summary || "").toLowerCase().includes("harden") || (t.title || "").includes("3"))).toBe(true);
    expect(remaining.length + completed.length).toBeGreaterThan(0);
    expect(["actionable", "completed"]).toContain(state.outcome);
  });

  it("keeps mixed task statuses separate and honors an explicit next action", () => {
    const raw = session([
      { role: "user", content: "Implement the health endpoint and document it." },
      {
        role: "assistant",
        content: "Task #1 completed in src/server.ts. Task #2 remains. Next action: document GET /health in README.md.",
      },
    ]);
    raw.meta.sourceCli = "grok";
    raw.extractionHints = {
      completedPatterns: [/HammaGrokHintProof #?(\d+).*?marker-phase-only/gi],
    };

    const state = extractTaskState(raw, {
      targetCli: "codex",
      repoState: { warnings: [] },
    });

    expect(state.tasks).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: "1", status: "completed", summary: "Task #1 completed in src/server.ts." }),
      expect.objectContaining({ id: "2", status: "remaining", summary: "Task #2 remains." }),
    ]));
    expect(state.nextAction).toBe("document GET /health in README.md.");
    expect(state.outcome).toBe("actionable");
  });

  it("integration on codex fixture: extractTaskState + renderHandoffMarkdown produce zero artifact noise in filesMentioned and Referenced section (rendered paths subset of state)", async () => {
    const raw = await parseCodexRollout(CODEX_FIXTURE);
    // inject noise mentions (including previously missed artifacts) to force filtering
    raw.messages.push({ role: "user", content: "check state.json handoff.md README.md troubleshooting.md doctor.ts ci.yml .github/workflows and examples/README" });
    const repoState = { warnings: [] as string[] };
    const state = extractTaskState(raw, { targetCli: "claude", repoState });
    const md = renderHandoffMarkdown(state, { compact: false });

    const isArtifactNoise = (f: string) => /handoff|state\.json|session\.json|README|troubleshooting|doctor|ci\.yml|examples|\.github/i.test(f) && !/\/src\//i.test(f);
    const stateNoise = state.filesMentioned.filter(isArtifactNoise);
    expect(stateNoise.length).toBe(0);

    const refMatch = md.match(/## Referenced files\n([\s\S]*?)(?=\n## |$)/);
    const refText = refMatch ? refMatch[1] : "";
    const refNoise = refText.split("\n").some(line => {
      const m = line.match(/-\s+(.*)$/);
      return m && isArtifactNoise(m[1].trim());
    });
    expect(refNoise).toBe(false);

    // rendered (non-ellipsis) paths should be subset of state
    const rendered = refText.split("\n")
      .filter(l => l.trim().startsWith("- ") && !l.includes("..."))
      .map(l => l.replace(/^\s*-\s+/, "").trim());
    for (const r of rendered) {
      const match = state.filesMentioned.some((sf: string) => sf === r || sf.endsWith("/" + r) || r.endsWith("/" + sf.split("/").pop()));
      expect(match).toBe(true);
    }
  });
});

describe("universal output shape from different sources (sweet-spot hybrid)", () => {
  function makeSession(sourceCli: "claude" | "codex" | "grok", content: string): HammaSession {
    return {
      meta: {
        sourceCli,
        sourceSessionId: `${sourceCli}-demo-1`,
        projectPath: "/tmp/hamma-universal-test",
      },
      messages: [
        { role: "user", content: "Implement feature X and verify." },
        { role: "assistant", content },
      ],
      shellCommands: [],
      parserWarnings: [],
      security: { redacted: false, redactionCount: 0, warnings: [] },
    };
  }

  it("extract + render from claude source produces universal HammaTaskState shape", () => {
    const raw = makeSession("claude", "Task #1 completed. Next is task #2: add tests.");
    const state = extractTaskState(raw, { targetCli: "grok", repoState: { warnings: [] } });
    expect(state.schemaVersion).toBe(1);
    expect(state).toHaveProperty("outcome");
    expect(state).toHaveProperty("tasks");
    expect(Array.isArray(state.tasks)).toBe(true);
    expect(state.project.sourceCli).toBe("claude");
    expect(state.project.targetCli).toBe("grok");
    const md = renderHandoffMarkdown(state, { compact: false });
    expect(md).toContain("## Agent execution contract");
    expect(md).toContain("Archive-only bounded tool diagnostics: tool_history.jsonl");
    // No native source parsing details leak; universal archives are clearly optional.
    expect(md).not.toMatch(/chat_history\.jsonl|updates\.jsonl/i);
  });

  it("extract + render from codex source produces universal shape", () => {
    const raw = makeSession("codex", "Fixed finding #1. Remaining task #2.");
    const state = extractTaskState(raw, { targetCli: "claude", repoState: { warnings: [] } });
    expect(state.schemaVersion).toBe(1);
    expect(state.project.sourceCli).toBe("codex");
    const md = renderHandoffMarkdown(state, { compact: true });
    expect(md).toContain("## Continue from here");
  });

  it("extract + render from grok source + heuristics extension produces universal shape", () => {
    const raw = makeSession("grok", "SpecialGrokTask #123 logo verification phase succeeded the check.");
    // attach via the session object (the path used by real grok parse in adapter)
    raw.extractionHints = {
      completedPatterns: [/SpecialGrokTask #?(\d+).*?(?:logo|completed|done)/gi],
    };
    const state = extractTaskState(raw, {
      targetCli: "codex",
      repoState: { warnings: [] },
      // intentionally omit heuristics: to prove session.extractionHints path
    });
    expect(state.schemaVersion).toBe(1);
    expect(state.project.sourceCli).toBe("grok");
    // the unique phrase only matched because of the attached hint (not default patterns)
    expect(state.tasks.some((t: any) => (t.summary || '').includes('SpecialGrokTask #123 logo verification phase succeeded the check.'))).toBe(true);
    const md = renderHandoffMarkdown(state, { compact: false });
    expect(md).toContain("## Safety notes");
    expect(md).toContain("Archive-only bounded tool diagnostics: tool_history.jsonl");
  });

});

import fs from "node:fs/promises";
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
const COMPLETED_PUBLISH_FIXTURE = path.join(
  HERE,
  "fixtures",
  "completed-publish-session.json"
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

  it("recognizes a release reported as fully live as terminal completion", () => {
    const state = extract([
      { role: "user", content: "Publish the release and verify installation." },
      {
        role: "assistant",
        content: "The release is now fully live. Both installation checks passed.",
      },
    ]);

    expect(state.outcome).toBe("completed");
    expect(state.nextAction).toBeUndefined();
    expect(state.tasks).toEqual([
      expect.objectContaining({ status: "completed" }),
    ]);
  });

  it("recognizes automation reported as implemented and verified as terminal completion", () => {
    const state = extract([
      {
        role: "user",
        content: "Actually, can we automate npm publishing with GitHub Actions?",
      },
      {
        role: "assistant",
        content: "The trusted publishing workflow is configured, but registry verification still needs to run.",
      },
      { role: "user", content: "done" },
      {
        role: "assistant",
        content:
          "npm publishing is now fully automated and verified. The trusted release completed successfully.",
      },
    ]);

    expect(state.outcome).toBe("completed");
    expect(state.nextAction).toBeUndefined();
    expect(state.tasks).toEqual([
      expect.objectContaining({
        status: "completed",
        summary: "Actually, can we automate npm publishing with GitHub Actions?",
      }),
    ]);
  });

  it("recognizes installed skills reported as available as terminal completion", () => {
    const state = extract([
      {
        role: "user",
        content: "install hammadev skills from the project repository",
      },
      {
        role: "assistant",
        content:
          "Installed three hammadev skills: hamma-snap, hamma-handoff, and hamma-resume. The skills are now available in the local Claude skills directory.",
      },
    ]);

    expect(state.outcome).toBe("completed");
    expect(state.nextAction).toBeUndefined();
    expect(state.tasks).toEqual([
      expect.objectContaining({
        status: "completed",
        summary: "install hammadev skills from the project repository",
      }),
    ]);
  });

  it("does not complete an installation that still names unresolved work", () => {
    const state = extract([
      { role: "user", content: "Install all requested development skills." },
      {
        role: "assistant",
        content:
          "The skills are now available, but the remaining task is to fix the failed activation check.",
      },
    ]);

    expect(state.outcome).toBe("actionable");
    expect(state.nextAction).toBe("Install all requested development skills.");
  });

  it("keeps explicit unresolved work actionable despite completion wording", () => {
    const state = extract([
      { role: "user", content: "Automate npm publishing with GitHub Actions." },
      {
        role: "assistant",
        content:
          "The publishing workflow is now fully automated and verified, but the next step is to fix the failing package smoke test.",
      },
    ]);

    expect(state.outcome).toBe("actionable");
    expect(state.nextAction).toBe("Automate npm publishing with GitHub Actions.");
  });

  it("does not interpret negated remaining-work language as unresolved work", () => {
    const state = extract([
      { role: "user", content: "Implement the release and verify the package." },
      {
        role: "assistant",
        content: "Task #1 completed. All tests passed. No remaining implementation work.",
      },
    ]);

    expect(state.outcome).toBe("completed");
    expect(state.nextAction).toBeUndefined();
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]?.status).toBe("completed");
  });
});

describe("current task epoch reconstruction", () => {
  it("reconstructs only the latest completed publishing task from a long session", async () => {
    const fixture = JSON.parse(
      await fs.readFile(COMPLETED_PUBLISH_FIXTURE, "utf8")
    ) as HammaSession;
    const state = extractTaskState(fixture, {
      targetCli: "claude",
      repoState: { warnings: [] },
    });

    expect(state.goal).toBe("proceed with update and publishing");
    expect(state.outcome).toBe("completed");
    expect(state.nextAction).toBeUndefined();
    expect(state.current.latestAssistantStatus).toContain("now fully live");
    expect(state.current.latestAssistantStatus).not.toContain(
      "confirm publication completed"
    );
    expect(state.current.taskEpoch).toMatchObject({
      startMessageIndex: 3,
      messageCount: 4,
      basis: "latest_substantive_user",
    });
    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0]).toMatchObject({
      status: "completed",
      summary: "proceed with update and publishing",
    });
    expect(state.tasks.some((task) => task.id !== undefined)).toBe(false);
    expect(state.risks).toEqual([]);
    expect(state.filesMentioned).not.toContain("website/src/App.tsx");
    expect(state.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          source: "command",
          command: "pnpm test",
          status: "passed",
        }),
        expect.objectContaining({
          source: "user_confirmation",
          summary: "done",
        }),
      ])
    );
    expect(
      state.evidence.some((item) => item.command === "pnpm typecheck")
    ).toBe(false);
  });

  it("does not promote an ordinary numbered report into task ledger items", () => {
    const state = extract([
      { role: "user", content: "Review the release evidence and summarize it." },
      {
        role: "assistant",
        content: "Release report\n1. Package metadata\n2. Verification\n3. Commits",
      },
    ]);

    expect(state.tasks).toHaveLength(1);
    expect(state.tasks[0].id).toBeUndefined();
  });

  it("retains numbered items under an explicit plan heading", () => {
    const state = extract([
      { role: "user", content: "Implement the parser reliability update." },
      {
        role: "assistant",
        content: "Plan:\n1. Inspect the parser\n2. Add regression coverage",
      },
    ]);

    expect(state.tasks).toEqual([
      expect.objectContaining({ id: "1", title: "Inspect the parser", status: "remaining" }),
      expect.objectContaining({ id: "2", title: "Add regression coverage", status: "remaining" }),
    ]);
  });

  it("removes a risk that is explicitly resolved later in the current epoch", () => {
    const state = extract([
      { role: "user", content: "Fix and verify the production build." },
      {
        role: "assistant",
        content: "The production build failed because generated types were stale.",
      },
      {
        role: "assistant",
        content: "The production build failure is now resolved and the build passes.",
      },
    ]);

    expect(state.risks).toEqual([]);
  });

  it("clears a publishing blocker after an explicit live-release result", () => {
    const state = extract([
      { role: "user", content: "Publish the package and verify the registry release." },
      {
        role: "assistant",
        content: "Publishing is blocked because the npm registry login is unavailable.",
      },
      {
        role: "assistant",
        content: "The package is now fully live on npm. AGENTS.md remains untouched.",
      },
    ]);

    expect(state.outcome).toBe("completed");
    expect(state.risks).toEqual([]);
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

  it("scopes task state to the latest substantive user objective", () => {
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
    expect(state.tasks).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ id: "4", status: "completed" }),
      ])
    );
    expect(state.tasks.some((task: any) => task.id === "3")).toBe(false);
    expect(state.current.taskEpoch).toMatchObject({
      startMessageIndex: 3,
      basis: "latest_substantive_user",
    });
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

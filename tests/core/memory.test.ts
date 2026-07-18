import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  inspectMemory,
  listMemories,
  mergeMemoryState,
  resolveMemoryProjectPath,
  startMemory,
} from "../../src/core/memory.js";
import { HammaTaskState } from "../../src/core/state.js";

let projectPath = "";

function state(overrides: Partial<HammaTaskState> = {}): HammaTaskState {
  return {
    schemaVersion: 1,
    outcome: "actionable",
    goal: "Ship the persistent task.",
    nextAction: "Implement task 2.",
    project: {
      path: projectPath,
      sourceCli: "codex",
      targetCli: "memory",
      sourceSessionId: "session-a",
    },
    current: { nextRecommendedTask: "Implement task 2." },
    tasks: [{
      id: "1",
      title: "Create parser",
      status: "completed",
      summary: "Create parser",
      evidence: ["earlier"],
      risks: [],
      filesMentioned: ["src/parser.ts"],
    }],
    verification: ["tests passed"],
    evidence: [{
      source: "command",
      kind: "tests",
      status: "passed",
      summary: "tests passed",
      command: "pnpm test",
      exitCode: 0,
    }],
    risks: [],
    filesMentioned: ["src/parser.ts"],
    repoState: { warnings: [] },
    references: {
      fullSession: "session.json",
      timeline: "timeline.md",
      commands: "commands.md",
      redactionReport: "redaction-report.md",
    },
    ...overrides,
  };
}

beforeEach(async () => {
  projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-memory-core-"));
});

afterEach(async () => {
  if (projectPath) await fs.rm(projectPath, { recursive: true, force: true });
});

describe("project memory storage", () => {
  it("creates an active named memory without inventing a first revision", async () => {
    const manifest = await startMemory(
      projectPath,
      "build-week",
      "Finish the Build Week release.",
      false
    );
    const inspection = await inspectMemory(projectPath);

    expect(manifest).toMatchObject({
      schemaVersion: 1,
      name: "build-week",
      goal: "Finish the Build Week release.",
      revisionCount: 0,
    });
    expect(inspection.active).toBe(true);
    expect(inspection.latest).toBeUndefined();
    expect(await listMemories(projectPath)).toMatchObject([
      { name: "build-week", active: true, revisionCount: 0 },
    ]);
  });

  it("switches the lightweight active pointer when another memory starts", async () => {
    await startMemory(projectPath, "auth-refactor", undefined, false);
    await startMemory(projectPath, "payment-bug", undefined, false);

    const entries = await listMemories(projectPath);
    expect(entries.find((entry) => entry.name === "payment-bug")?.active).toBe(true);
    expect(entries.find((entry) => entry.name === "auth-refactor")?.active).toBe(false);
  });

  it("rejects traversal, uppercase, and path-like names", async () => {
    await expect(startMemory(projectPath, "../escape", undefined, false)).rejects.toThrow(
      "Invalid memory name"
    );
    await expect(startMemory(projectPath, "BuildWeek", undefined, false)).rejects.toThrow(
      "Invalid memory name"
    );
  });

  it("rejects a symlinked memory root", async () => {
    const outside = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-memory-outside-"));
    try {
      await fs.mkdir(path.join(projectPath, ".hamma"));
      await fs.symlink(outside, path.join(projectPath, ".hamma", "memories"));
      await expect(startMemory(projectPath, "unsafe", undefined, false)).rejects.toThrow(
        /safe directory|symbolic-link/
      );
    } finally {
      await fs.rm(outside, { recursive: true, force: true });
    }
  });

  it("uses the Git top level for project-scoped memory", async () => {
    const nested = path.join(projectPath, "packages", "app");
    await fs.mkdir(nested, { recursive: true });
    const { execFileSync } = await import("node:child_process");
    execFileSync("git", ["-C", projectPath, "init", "-q"]);
    expect(resolveMemoryProjectPath(nested)).toBe(projectPath);
  });
});

describe("memory state merge", () => {
  it("preserves original goal, completed work, and evidence while accepting current state", () => {
    const previous = state();
    const current = state({
      goal: "A narrower new-session instruction.",
      nextAction: "Verify task 2.",
      project: {
        path: projectPath,
        sourceCli: "claude",
        targetCli: "memory",
        sourceSessionId: "session-b",
      },
      tasks: [
        {
          id: "1",
          title: "Create parser",
          status: "remaining",
          summary: "Create parser",
          evidence: ["newer"],
          risks: [],
          filesMentioned: ["src/parser.ts"],
        },
        {
          id: "2",
          title: "Verify parser",
          status: "remaining",
          summary: "Verify parser",
          evidence: [],
          risks: [],
          filesMentioned: ["tests/parser.test.ts"],
        },
      ],
      evidence: [{
        source: "agent_claim",
        kind: "task_status",
        status: "claimed",
        summary: "task 2 remains",
      }],
      verification: [],
      filesMentioned: ["tests/parser.test.ts"],
    });

    const merged = mergeMemoryState(previous, current);

    expect(merged.state.goal).toBe("Ship the persistent task.");
    expect(merged.state.project.sourceCli).toBe("claude");
    expect(merged.state.nextAction).toBe("Verify task 2.");
    expect(merged.state.tasks.find((task) => task.id === "1")?.status).toBe("completed");
    expect(merged.state.tasks.find((task) => task.id === "2")?.status).toBe("remaining");
    expect(merged.state.evidence).toHaveLength(2);
    expect(merged.state.filesMentioned).toEqual(
      expect.arrayContaining(["src/parser.ts", "tests/parser.test.ts"])
    );
    expect(merged.warnings.join(" ")).toContain("Preserved completed status");
  });

  it("is deterministic for identical inputs", () => {
    const previous = state();
    const current = state({ project: { ...state().project, sourceCli: "claude" } });
    expect(mergeMemoryState(previous, current)).toEqual(
      mergeMemoryState(previous, current)
    );
  });

  it("retains both tasks when an agent reuses an id for different work", () => {
    const previous = state();
    const current = state({
      tasks: [{
        id: "1",
        title: "Deploy payment service",
        status: "remaining",
        summary: "Deploy payment service",
        evidence: [],
        risks: [],
        filesMentioned: ["src/payments.ts"],
      }],
    });

    const merged = mergeMemoryState(previous, current);
    expect(merged.state.tasks.filter((task) => task.id === "1")).toHaveLength(2);
    expect(merged.warnings.join(" ")).toContain("reused with different text");
  });
});

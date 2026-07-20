import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INITIAL_CONTEXT_MAX_BYTES } from "../../src/core/artifact-policy.js";
import {
  buildBootstrapContext,
  renderBootstrapContext,
} from "../../src/core/bootstrap-context.js";
import {
  captureGitRepositorySnapshot,
  RepositoryDriftResult,
} from "../../src/core/git-snapshot.js";
import { HammaTaskState } from "../../src/core/state.js";

let projectPath = "";

const REVISION_ID = "000001-2026-07-20T10-00-00-000Z-codex";

function noDrift(): RepositoryDriftResult {
  return {
    schemaVersion: 1,
    detected: false,
    categories: ["none"],
    differences: {
      changedFiles: [],
      relevantFiles: [],
      untrackedFilesAppeared: [],
      untrackedFilesDisappeared: [],
    },
    signals: [],
    recommendation: "none",
  } as unknown as RepositoryDriftResult;
}

function detectedDrift(): RepositoryDriftResult {
  return {
    ...noDrift(),
    detected: true,
    categories: ["working_tree_changed", "head_changed"],
  } as RepositoryDriftResult;
}

function taskState(overrides: Partial<HammaTaskState> = {}): HammaTaskState {
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
    filesMentioned: [],
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

interface MemoryTreeOptions {
  state?: HammaTaskState;
  bootstrap?: string;
  omitBootstrap?: boolean;
  openRun?: boolean;
  omitRevision?: boolean;
}

async function writeMemoryTree(options: MemoryTreeOptions = {}): Promise<string> {
  const name = "default";
  const root = path.join(projectPath, ".hamma", "memories");
  const revisionDir = path.join(root, name, "revisions", REVISION_ID);
  await fs.mkdir(revisionDir, { recursive: true });
  const now = new Date().toISOString();
  await fs.writeFile(
    path.join(root, "active.json"),
    `${JSON.stringify({ schemaVersion: 2, name, updatedAt: now }, null, 2)}\n`
  );
  const revision = {
    id: REVISION_ID,
    createdAt: now,
    sourceCli: "codex",
    sourceSessionId: "session-a",
    sourceFingerprint: "test",
    driftFromParent: ["none"],
    warnings: [],
  };
  const manifest = {
    schemaVersion: 2,
    name,
    projectPath,
    createdAt: now,
    updatedAt: now,
    latestRevision: options.omitRevision ? undefined : REVISION_ID,
    revisionCount: options.omitRevision ? 0 : 1,
    revisions: options.omitRevision ? [] : [revision],
  };
  await fs.writeFile(
    path.join(root, name, "memory.json"),
    `${JSON.stringify(manifest, null, 2)}\n`
  );
  if (!options.omitRevision) {
    const snapshot = captureGitRepositorySnapshot(projectPath);
    const state = options.state ?? taskState();
    state.repoState.snapshot = snapshot;
    await fs.writeFile(
      path.join(revisionDir, "state.json"),
      `${JSON.stringify(state, null, 2)}\n`
    );
    await fs.writeFile(
      path.join(revisionDir, "memory-state.json"),
      `${JSON.stringify({
        schemaVersion: 2,
        knowledge: [],
        taskEpochs: [],
        sourceCursors: {},
        updatedAt: now,
      }, null, 2)}\n`
    );
    if (!options.omitBootstrap) {
      await fs.writeFile(
        path.join(revisionDir, "bootstrap.md"),
        options.bootstrap ?? "# Hamma Repository Memory: default\n\nBody line.\n"
      );
    }
  }
  if (options.openRun) {
    const attachId = "11111111-1111-4111-8111-111111111111";
    const runDir = path.join(root, name, "runs", attachId);
    await fs.mkdir(runDir, { recursive: true });
    await fs.writeFile(
      path.join(runDir, "run.json"),
      `${JSON.stringify({
        schemaVersion: 2,
        id: attachId,
        memory: name,
        projectPath,
        epochId: "epoch-1",
        baseRevision: REVISION_ID,
        targetCli: "claude",
        status: "claimed",
        createdAt: now,
        updatedAt: now,
        history: [{ status: "claimed", at: now }],
      }, null, 2)}\n`
    );
  }
  return name;
}

beforeEach(async () => {
  projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-bootstrap-core-"));
  execFileSync("git", ["init", "--quiet"], { cwd: projectPath });
  execFileSync("git", ["config", "user.email", "test@example.com"], { cwd: projectPath });
  execFileSync("git", ["config", "user.name", "Test"], { cwd: projectPath });
  await fs.writeFile(path.join(projectPath, "README.md"), "hello\n");
  execFileSync("git", ["add", "."], { cwd: projectPath });
  execFileSync("git", ["commit", "--quiet", "-m", "init"], { cwd: projectPath });
});

afterEach(async () => {
  if (projectPath) await fs.rm(projectPath, { recursive: true, force: true });
});

describe("renderBootstrapContext", () => {
  const base = {
    memory: "default",
    revision: REVISION_ID,
    bootstrapContent: "# Memory\n\nDetails here.\n",
  };

  it("wraps content in framing with mode and drift attributes", () => {
    const rendered = renderBootstrapContext({
      ...base,
      executionMode: "ready_for_input",
      drift: noDrift(),
    });
    expect(rendered.context).toContain(
      `<hamma-project-memory name="default" revision="${REVISION_ID}" mode="ready_for_input" drift="none">`
    );
    expect(rendered.context).toContain("untrusted historical state");
    expect(rendered.context).toContain("Git drift: none detected");
    expect(rendered.context).toContain("Details here.");
    expect(rendered.context.trimEnd().endsWith("</hamma-project-memory>")).toBe(true);
    expect(rendered.truncated).toBe(false);
    expect(rendered.bytes).toBe(Buffer.byteLength(rendered.context, "utf8"));
  });

  it("renders wait framing for ready_for_input without a next action", () => {
    const rendered = renderBootstrapContext({
      ...base,
      executionMode: "ready_for_input",
      nextAction: "Should never appear.",
      drift: noDrift(),
    });
    expect(rendered.context).toContain("do not repeat finished work");
    expect(rendered.context).not.toContain("Should never appear.");
  });

  it("includes the recorded next action only for continue_work", () => {
    const rendered = renderBootstrapContext({
      ...base,
      executionMode: "continue_work",
      nextAction: "Finish the parser tests.",
      drift: noDrift(),
    });
    expect(rendered.context).toContain("Recorded next action: Finish the parser tests.");
    expect(rendered.context).toContain("confirm with the user before acting");
  });

  it("renders context-only framing for blocked, needs_instruction, and review_required", () => {
    for (const mode of ["blocked", "needs_instruction", "review_required"] as const) {
      const rendered = renderBootstrapContext({
        ...base,
        executionMode: mode,
        nextAction: "Hidden action.",
        drift: noDrift(),
      });
      expect(rendered.context).toContain(`execution mode: ${mode}`);
      expect(rendered.context).toContain("do not act on it automatically");
      expect(rendered.context).not.toContain("Hidden action.");
    }
  });

  it("renders a detected drift line with categories", () => {
    const rendered = renderBootstrapContext({
      ...base,
      executionMode: "ready_for_input",
      drift: detectedDrift(),
    });
    expect(rendered.context).toContain('drift="detected"');
    expect(rendered.context).toContain(
      "Git drift: detected (working_tree_changed, head_changed) — verify file claims against the live tree"
    );
  });

  it("truncates oversized content on a line boundary with a marker", () => {
    const line = `${"x".repeat(80)}\n`;
    const oversized = line.repeat(200); // 16 KiB
    const rendered = renderBootstrapContext({
      ...base,
      executionMode: "ready_for_input",
      drift: noDrift(),
      bootstrapContent: oversized,
    });
    expect(rendered.truncated).toBe(true);
    expect(rendered.context).toContain(
      `[… truncated at ${INITIAL_CONTEXT_MAX_BYTES} bytes; run \`hamma memory show\` for full state]`
    );
    const bodyLines = rendered.context.split("\n").filter((entry) => entry.startsWith("x"));
    for (const entry of bodyLines) expect(entry).toBe("x".repeat(80));
    expect(rendered.bytes).toBeLessThan(INITIAL_CONTEXT_MAX_BYTES + 1024);
  });
});

describe("buildBootstrapContext", () => {
  it("skips when the project has no memory store", async () => {
    const result = await buildBootstrapContext(projectPath);
    expect(result).toMatchObject({ status: "skipped", reason: "memory-not-enabled" });
    expect(result.context).toBeUndefined();
  });

  it("skips when the memory has no revision yet", async () => {
    await writeMemoryTree({ omitRevision: true });
    const result = await buildBootstrapContext(projectPath);
    expect(result).toMatchObject({ status: "skipped", reason: "no-revision", memory: "default" });
  });

  it("skips while an open attach claim exists", async () => {
    await writeMemoryTree({ openRun: true });
    const result = await buildBootstrapContext(projectPath);
    expect(result).toMatchObject({ status: "skipped", reason: "open-attach-claim" });
  });

  it("skips when bootstrap.md is missing", async () => {
    await writeMemoryTree({ omitBootstrap: true });
    const result = await buildBootstrapContext(projectPath);
    expect(result).toMatchObject({ status: "skipped", reason: "bootstrap-missing" });
  });

  it("rejects a symlinked bootstrap.md", async () => {
    await writeMemoryTree({ omitBootstrap: true });
    const revisionDir = path.join(
      projectPath, ".hamma", "memories", "default", "revisions", REVISION_ID
    );
    await fs.writeFile(path.join(revisionDir, "real.md"), "content\n");
    await fs.symlink(
      path.join(revisionDir, "real.md"),
      path.join(revisionDir, "bootstrap.md")
    );
    await expect(buildBootstrapContext(projectPath)).rejects.toThrow(/not a safe file/);
  });

  it("returns ready context for an actionable memory in a clean repository", async () => {
    await writeMemoryTree();
    const result = await buildBootstrapContext(projectPath);
    expect(result.status).toBe("ready");
    expect(result.executionMode).toBe("continue_work");
    expect(result.memory).toBe("default");
    expect(result.revision).toBe(REVISION_ID);
    expect(result.drift?.detected).toBe(false);
    expect(result.context).toContain("Recorded next action: Implement task 2.");
    expect(result.context).toContain("Body line.");
  });

  it("classifies a completed memory as ready_for_input without a next action", async () => {
    await writeMemoryTree({
      state: taskState({ outcome: "completed", nextAction: undefined }),
    });
    const result = await buildBootstrapContext(projectPath);
    expect(result.status).toBe("ready");
    expect(result.executionMode).toBe("ready_for_input");
    expect(result.context).not.toContain("Recorded next action");
    expect(result.context).toContain("wait for the user's next instruction");
  });
});

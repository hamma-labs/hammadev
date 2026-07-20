import { execFile, spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "src", "cli.ts");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");
const SESSION_ID = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
let fixtureRoot = "";
let projectPath = "";
let fakeHome = "";
let sessionPath = "";

async function run(args: string[]): Promise<string> {
  const result = await execFileAsync(TSX, [CLI, ...args], {
    cwd: projectPath,
    env: { ...process.env, HOME: fakeHome },
  });
  return result.stdout;
}

async function runWithInput(args: string[], cwd: string, input: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [CLI, ...args], {
      cwd,
      env: { ...process.env, HOME: fakeHome },
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`CLI exited ${code}: ${stderr}`));
    });
    child.stdin.end(input);
  });
}

async function writeSession(completed = false): Promise<void> {
  const records = [
    {
      type: "user",
      uuid: "user-1",
      sessionId: SESSION_ID,
      cwd: projectPath,
      timestamp: "2026-07-18T10:00:00Z",
      message: {
        role: "user",
        content: "Implement task #1: add persistent named project memory in src/core/memory.ts.",
      },
    },
    {
      type: "assistant",
      uuid: "assistant-1",
      sessionId: SESSION_ID,
      timestamp: "2026-07-18T10:01:00Z",
      message: {
        role: "assistant",
        content: completed
          ? "Task #1 completed. All tests passed. No remaining implementation work."
          : "Task #1 remains. Next is task #1: implement immutable memory revisions.",
      },
    },
  ];
  await fs.writeFile(
    sessionPath,
    `${records.map((record) => JSON.stringify(record)).join("\n")}\n`,
    "utf8"
  );
  const mtime = completed
    ? new Date("2026-07-18T10:03:00Z")
    : new Date("2026-07-18T10:02:00Z");
  await fs.utimes(sessionPath, mtime, mtime);
}

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-cli-memory-"));
  projectPath = path.join(fixtureRoot, "project");
  fakeHome = path.join(fixtureRoot, "home");
  sessionPath = path.join(
    fakeHome,
    ".claude",
    "projects",
    "synthetic-project",
    `${SESSION_ID}.jsonl`
  );
  await fs.mkdir(projectPath, { recursive: true });
  await fs.mkdir(path.dirname(sessionPath), { recursive: true });
  await execFileAsync("git", ["-C", projectPath, "init", "-q"]);
  await execFileAsync("git", ["-C", projectPath, "config", "user.email", "memory@example.test"]);
  await execFileAsync("git", ["-C", projectPath, "config", "user.name", "Memory Test"]);
  await fs.writeFile(path.join(projectPath, "README.md"), "synthetic memory project\n");
  await execFileAsync("git", ["-C", projectPath, "add", "README.md"]);
  await execFileAsync("git", ["-C", projectPath, "commit", "-qm", "initial"]);
  await writeSession(false);
});

afterAll(async () => {
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("memory CLI", () => {
  it("starts, synchronizes, inspects, and resumes one stable named thread", async () => {
    const started = JSON.parse(await run([
      "memory", "start", "build-week", "--goal", "Ship the Build Week release.",
      "--json", "--no-gitignore",
    ]));
    expect(started).toMatchObject({ name: "build-week", revisionCount: 0 });

    const first = JSON.parse(await run([
      "memory", "sync", "--source", `claude:${SESSION_ID}`,
      "--json", "--no-gitignore",
    ]));
    expect(first).toMatchObject({
      updated: true,
      memory: "build-week",
      selection: { mode: "explicit", sourceCli: "claude" },
    });
    expect(first.revision.parentRevision).toBeUndefined();
    expect(first.contextBudget).toMatchObject({
      initialArtifacts: ["bootstrap.md"],
      maxBytes: 8192,
      withinBudget: true,
    });
    expect(await fs.readdir(first.revisionPath)).toEqual(
      expect.arrayContaining(["bootstrap.md", "conversation.jsonl", "handoff.md", "memory-state.json", "revision.json", "state.json", "tool_history.jsonl"])
    );
    expect(await fs.readdir(first.revisionPath)).not.toContain("session.json");
    expect(await fs.readFile(first.bootstrapPath, "utf8")).toContain(
      "Hamma Repository Memory"
    );

    const noOp = JSON.parse(await run([
      "memory", "sync", "--source", `claude:${SESSION_ID}`,
      "--json", "--no-gitignore",
    ]));
    expect(noOp).toMatchObject({ updated: false, memory: "build-week" });

    await execFileAsync("git", ["-C", projectPath, "checkout", "-qb", "feature/memory"]);
    await writeSession(true);
    const second = JSON.parse(await run([
      "memory", "sync", "--source", `claude:${SESSION_ID}`,
      "--json", "--no-gitignore",
    ]));
    expect(second.updated).toBe(true);
    expect(second.revision.parentRevision).toBe(first.revision.id);
    expect(second.revision.driftFromParent).toContain("branch_changed");
    expect(second.warnings.join(" ")).toContain("Repository differences");
    await expect(fs.stat(first.statePath)).resolves.toBeTruthy();

    const shown = JSON.parse(await run(["memory", "show", "--json"]));
    expect(shown).toMatchObject({
      active: true,
      manifest: { name: "build-week", revisionCount: 2 },
      latest: { revision: { id: second.revision.id } },
    });
    expect(shown.latest.state.goal).toBe("Ship the Build Week release.");

    const resumed = JSON.parse(await run([
      "memory", "resume", "build-week", "--to", "codex", "--json",
    ]));
    expect(resumed).toMatchObject({
      memory: "build-week",
      targetCli: "codex",
      revision: second.revision.id,
      resumeAllowed: false,
    });
    expect(resumed.suggestedCommand).toContain("do not repeat old work");
    expect(resumed.suggestedCommand).not.toContain("tool_history.jsonl");
    expect(resumed.contextBudget).toMatchObject({
      initialArtifacts: ["bootstrap.md"],
      maxBytes: 8192,
      withinBudget: true,
    });

    const hookNoOp = JSON.parse(await runWithInput(
      ["memory", "sync", "--hook-agent", "claude", "--json", "--no-gitignore"],
      projectPath,
      JSON.stringify({ session_id: SESSION_ID })
    ));
    expect(hookNoOp).toMatchObject({
      updated: false,
      selection: {
        mode: "explicit",
        sourceCli: "claude",
        sourceSessionId: SESSION_ID,
      },
    });
    expect(await runWithInput(
      ["memory", "sync", "--hook-agent", "claude", "--no-gitignore"],
      projectPath,
      JSON.stringify({ session_id: SESSION_ID })
    )).toBe("");

    const listed = JSON.parse(await run(["memory", "list", "--json"]));
    expect(listed.memories).toMatchObject([
      { name: "build-week", active: true, revisionCount: 2 },
    ]);

    await run([
      "memory", "start", "other-thread", "--json", "--no-gitignore",
    ]);
    expect(JSON.parse(await run(["memory", "list", "--json"])).memories)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "other-thread", active: true }),
        expect.objectContaining({ name: "build-week", active: false }),
      ]));
    await run(["memory", "resume", "build-week", "--to", "codex", "--json"]);
    expect(JSON.parse(await run(["memory", "list", "--json"])).memories)
      .toEqual(expect.arrayContaining([
        expect.objectContaining({ name: "other-thread", active: false }),
        expect.objectContaining({ name: "build-week", active: true }),
      ]));
  }, 30_000);

  it("requires exact source selection and preserves frozen attach state", async () => {
    await run([
      "memory", "start", "automatic-thread", "--json", "--no-gitignore",
    ]);
    await expect(run([
      "memory", "sync", "--json", "--no-gitignore",
    ])).rejects.toThrow("requires an exact");

    const updatePath = path.join(fixtureRoot, "memory-update.json");
    await fs.writeFile(updatePath, JSON.stringify({
      sessionSummary: "The persistent memory implementation is complete.",
      projectSummary: "A local repository memory CLI.",
      decisions: [{
        decision: "Use immutable v2 revisions.",
        rationale: "Old snapshots remain auditable.",
        files: ["src/core/memory.ts"],
      }],
      constraints: ["Keep memory local under .hamma/.", "token=super-secret-value-that-must-not-persist"],
      discoveries: ["Completed epochs should remain loadable context."],
    }));
    const structured = JSON.parse(await run([
      "memory", "sync", "automatic-thread", "--source", `claude:${SESSION_ID}`,
      "--update-file", updatePath, "--json", "--no-gitignore",
    ]));
    expect(structured.updated).toBe(true);
    expect(structured.memoryStatePath).toContain("memory-state.json");
    expect(await fs.readFile(structured.memoryStatePath, "utf8")).not.toContain("super-secret-value");
    expect(structured.warnings.join(" ")).toContain("Redacted 1 potential secret");

    const autoAttached = JSON.parse(await run([
      "memory", "attach", "automatic-thread", "--to", "codex", "--json",
    ]));
    expect(autoAttached.syncStatus).toBe("skipped");
    expect(autoAttached.revision).toBe(structured.revision.id);

    let attached = JSON.parse(await run([
      "memory", "attach", "automatic-thread", "--to", "codex", "--no-sync", "--json",
    ]));
    expect(attached).toMatchObject({
      schemaVersion: 2,
      memoryLoadAllowed: true,
      autoExecuteAllowed: false,
      executionMode: "ready_for_input",
      previousOutcome: "completed",
      syncStatus: "skipped",
    });
    expect(attached.suggestedCommand).toContain("do not repeat old work");
    expect(attached.contextBudget.combinedBytes).toBeLessThanOrEqual(8192);

    const recalled = JSON.parse(await run([
      "memory", "recall", "automatic-thread", "--query", "immutable v2 revisions", "--json",
    ]));
    expect(recalled.results[0]).toMatchObject({ kind: "knowledge", category: "decision" });

    const laterUpdatePath = path.join(fixtureRoot, "later-memory-update.json");
    await fs.writeFile(laterUpdatePath, JSON.stringify({
      sessionSummary: "A later task update must not replace the project identity.",
      discoveries: ["Project summaries only change through explicit projectSummary updates."],
    }));
    const later = JSON.parse(await run([
      "memory", "sync", "automatic-thread", "--source", `claude:${SESSION_ID}`,
      "--update-file", laterUpdatePath, "--json", "--no-gitignore",
    ]));
    expect(JSON.parse(await fs.readFile(later.memoryStatePath, "utf8")).projectSummary)
      .toBe("A local repository memory CLI.");
  }, 20_000);

  it("claims actionable work once and finishes the same epoch explicitly", async () => {
    await writeSession(false);
    await run(["memory", "start", "lifecycle", "--json", "--no-gitignore"]);
    const synced = JSON.parse(await run([
      "memory", "sync", "lifecycle", "--source", `claude:${SESSION_ID}`,
      "--json", "--no-gitignore",
    ]));
    const beforeEpoch = JSON.parse(await fs.readFile(synced.memoryStatePath, "utf8")).activeEpochId;

    let attached = JSON.parse(await run([
      "memory", "attach", "lifecycle", "--to", "claude", "--json",
    ]));
    expect(attached).toMatchObject({
      executionMode: "continue_work",
      autoExecuteAllowed: true,
      run: { status: "claimed", epochId: beforeEpoch },
    });
    expect(attached.attachId).toMatch(/^[0-9a-f-]{36}$/);
    expect(attached.suggestedCommand).toContain(`[HAMMA_ATTACH_ID:${attached.attachId}]`);
    await expect(run([
      "memory", "attach", "lifecycle", "--to", "claude", "--json",
    ])).rejects.toThrow("already has open attach run");
    await expect(run([
      "memory", "sync", "lifecycle", "--source", `claude:${SESSION_ID}`,
      "--json", "--no-gitignore",
    ])).rejects.toThrow("use memory checkpoint or finish");
    const abandoned = JSON.parse(await run([
      "memory", "abandon", "lifecycle", "--attach", attached.attachId,
      "--reason", "Testing explicit claim release.", "--json",
    ]));
    expect(abandoned.run.status).toBe("abandoned");
    attached = JSON.parse(await run([
      "memory", "attach", "lifecycle", "--to", "claude", "--json",
    ]));
    expect(attached.run.status).toBe("claimed");

    const checkpointPath = path.join(fixtureRoot, "checkpoint-update.json");
    await fs.writeFile(checkpointPath, JSON.stringify({
      sessionSummary: "The exact-source guard is implemented; lifecycle closure remains.",
      outcome: "actionable",
      nextAction: "Close the claimed epoch after verification.",
    }));
    const checkpointed = JSON.parse(await run([
      "memory", "checkpoint", "lifecycle", "--attach", attached.attachId,
      "--source", `claude:${SESSION_ID}`, "--update-file", checkpointPath,
      "--json", "--no-gitignore",
    ]));
    expect(checkpointed.run.status).toBe("running");
    expect(JSON.parse(await fs.readFile(checkpointed.memoryStatePath, "utf8")).activeEpochId)
      .toBe(beforeEpoch);

    const updatePath = path.join(fixtureRoot, "finish-update.json");
    await fs.writeFile(updatePath, JSON.stringify({
      sessionSummary: "Immutable memory revisions are implemented and verified.",
      projectSummary: "Stable repository continuity across coding agents.",
      outcome: "completed",
      nextAction: null,
      decisions: ["Require exact source sessions for every memory write."],
      discoveries: ["Attach claims prevent duplicate execution."],
    }));
    const finished = JSON.parse(await run([
      "memory", "finish", "lifecycle", "--attach", attached.attachId,
      "--source", `claude:${SESSION_ID}`, "--update-file", updatePath,
      "--json", "--no-gitignore",
    ]));
    expect(finished.run.status).toBe("completed");
    const finishedState = JSON.parse(await fs.readFile(finished.memoryStatePath, "utf8"));
    expect(finishedState.activeEpochId).toBe(beforeEpoch);
    expect(finishedState.taskEpochs).toHaveLength(1);
    expect(finishedState.taskEpochs[0].outcome).toBe("completed");
    expect(finishedState.taskEpochs[0].nextAction).toBeUndefined();

    const contextOnly = JSON.parse(await run([
      "memory", "attach", "lifecycle", "--to", "codex", "--json",
    ]));
    expect(contextOnly).toMatchObject({ executionMode: "ready_for_input", autoExecuteAllowed: false });
    expect(contextOnly.attachId).toBeUndefined();
    expect(contextOnly.suggestedCommand).toContain("hamma codex --memory \"lifecycle\" --");
    expect(contextOnly.suggestedCommand).toContain("[HAMMA_CONTEXT_LOAD]");
  }, 30_000);

  it("creates default on explicit sync and rejects invalid updates atomically", async () => {
    await fs.rm(path.join(projectPath, ".hamma", "memories", "active.json"), { force: true });
    const synced = JSON.parse(await run([
      "memory", "sync", "--source", `claude:${SESSION_ID}`, "--json", "--no-gitignore",
    ]));
    expect(synced).toMatchObject({ schemaVersion: 2, memory: "default", updated: true });
    const before = JSON.parse(await run(["memory", "show", "default", "--json"]));
    const invalidPath = path.join(fixtureRoot, "invalid-update.json");
    await fs.writeFile(invalidPath, JSON.stringify({ sessionSummary: "x", unknown: true }));
    await expect(run([
      "memory", "sync", "default", "--source", `claude:${SESSION_ID}`,
      "--update-file", invalidPath, "--json", "--no-gitignore",
    ])).rejects.toThrow();
    const after = JSON.parse(await run(["memory", "show", "default", "--json"]));
    expect(after.manifest.revisionCount).toBe(before.manifest.revisionCount);
  }, 20_000);

  it("reads v1 revisions through a transient view and migrates lazily", async () => {
    await run(["memory", "start", "legacy-thread", "--json", "--no-gitignore"]);
    const original = JSON.parse(await run([
      "memory", "sync", "legacy-thread", "--source", `claude:${SESSION_ID}`,
      "--json", "--no-gitignore",
    ]));
    const manifestPath = path.join(projectPath, ".hamma", "memories", "legacy-thread", "memory.json");
    const manifest = JSON.parse(await fs.readFile(manifestPath, "utf8"));
    manifest.schemaVersion = 1;
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);
    await fs.rm(path.join(original.revisionPath, "bootstrap.md"));
    await fs.rm(path.join(original.revisionPath, "memory-state.json"));
    await fs.rm(path.join(original.revisionPath, "conversation.jsonl"));

    const shown = JSON.parse(await run(["memory", "show", "legacy-thread", "--json"]));
    expect(shown).toMatchObject({ schemaVersion: 2, compatibilityView: true });
    const attached = JSON.parse(await run([
      "memory", "attach", "legacy-thread", "--to", "codex", "--no-sync", "--json",
    ]));
    expect(attached.contextBudget.initialArtifacts).toEqual(["handoff.md"]);
    expect(attached.bootstrapPath).toBe(original.handoffPath);
    if (attached.attachId) {
      await run([
        "memory", "abandon", "legacy-thread", "--attach", attached.attachId,
        "--reason", "Continue the lazy migration compatibility test.", "--json",
      ]);
    }

    const updatePath = path.join(fixtureRoot, "legacy-update.json");
    await fs.writeFile(updatePath, JSON.stringify({
      sessionSummary: "Migrated legacy memory without changing its original revision.",
      discoveries: ["V1 remains readable."],
    }));
    const migrated = JSON.parse(await run([
      "memory", "sync", "legacy-thread", "--source", `claude:${SESSION_ID}`,
      "--update-file", updatePath, "--json", "--no-gitignore",
    ]));
    expect(migrated.updated).toBe(true);
    expect(migrated.warnings.join(" ")).toContain("Migrated the latest v1 state");
    expect(JSON.parse(await fs.readFile(manifestPath, "utf8")).schemaVersion).toBe(2);
    await expect(fs.stat(path.join(original.revisionPath, "memory-state.json"))).rejects.toThrow();
    await expect(fs.stat(migrated.memoryStatePath)).resolves.toBeTruthy();
  }, 20_000);

  it("keeps JSON stdout valid for native-hook no-active fallback", async () => {
    const emptyProject = path.join(fixtureRoot, "empty-project");
    await fs.mkdir(emptyProject);
    const result = await runWithInput(
      ["memory", "sync", "--hook-agent", "codex", "--json"],
      emptyProject,
      JSON.stringify({ session_id: "codex-session" })
    );
    expect(JSON.parse(result)).toMatchObject({
      updated: false,
      skipped: true,
    });
  });
});

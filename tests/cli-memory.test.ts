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
    expect(await fs.readdir(first.revisionPath)).toEqual(
      expect.arrayContaining(["handoff.md", "revision.json", "state.json", "tool_history.jsonl"])
    );
    expect(await fs.readdir(first.revisionPath)).not.toContain("session.json");
    expect(await fs.readFile(first.handoffPath, "utf8")).toContain(
      "Full native or normalized transcripts are not copied"
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
    });
    expect(resumed.suggestedCommand).toContain("Resume Hamma project memory 'build-week'");

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
  }, 30_000);

  it("can safely select the newest resumable project session when source is omitted", async () => {
    await run([
      "memory", "start", "automatic-thread", "--json", "--no-gitignore",
    ]);
    const result = JSON.parse(await run([
      "memory", "sync", "--json", "--no-gitignore",
    ]));
    expect(result).toMatchObject({
      updated: true,
      memory: "automatic-thread",
      selection: {
        mode: "automatic",
        sourceCli: "claude",
        sourceSessionId: SESSION_ID,
      },
    });
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

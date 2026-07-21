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
const SESSION_ID = "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb";
let fixtureRoot = "";
let projectPath = "";
let fakeHome = "";
let sessionPath = "";

async function run(args: string[], cwd = projectPath): Promise<string> {
  const result = await execFileAsync(TSX, [CLI, ...args], {
    cwd,
    env: { ...process.env, HOME: fakeHome },
  });
  return result.stdout;
}

async function runWithInput(
  args: string[],
  cwd: string,
  input: string,
  extraEnv: Record<string, string> = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [CLI, ...args], {
      cwd,
      env: { ...process.env, HOME: fakeHome, ...extraEnv },
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
        content: "Implement task #1: add session-start bootstrap output in src/core/bootstrap-context.ts.",
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
          : "Task #1 remains. Next is task #1: implement the bounded session-start renderer.",
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

const HOOK_EVENT = JSON.stringify({ session_id: SESSION_ID, source: "startup" });

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-cli-bootstrap-"));
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
  await execFileAsync("git", ["-C", projectPath, "config", "user.email", "bootstrap@example.test"]);
  await execFileAsync("git", ["-C", projectPath, "config", "user.name", "Bootstrap Test"]);
  await fs.writeFile(path.join(projectPath, "README.md"), "synthetic bootstrap project\n");
  await execFileAsync("git", ["-C", projectPath, "add", "README.md"]);
  await execFileAsync("git", ["-C", projectPath, "commit", "-qm", "initial"]);
  await writeSession(false);
  // The suite below exercises the historical always-inject behavior; the
  // shipped default is 'manual', which is covered by the "bootstrap modes"
  // describe block.
  await run(["config", "set", "bootstrap", "automatic"]);
}, 30_000);

afterAll(async () => {
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("bootstrap CLI", () => {
  it("emits nothing in hook mode while memory is not enabled", async () => {
    const stdout = await runWithInput(
      ["bootstrap", "--hook-agent", "claude"],
      projectPath,
      HOOK_EVENT
    );
    expect(stdout).toBe("");
  });

  it("reports the skip reason with --json", async () => {
    const result = JSON.parse(await run(["bootstrap", "--json"]));
    expect(result).toMatchObject({
      schemaVersion: 1,
      status: "skipped",
      reason: "memory-not-enabled",
    });
  });

  it("emits framed bounded context in hook mode once memory is synchronized", async () => {
    await run(["memory", "start", "bootstrap-thread", "--json", "--no-gitignore"]);
    await run(["memory", "sync", "--source", `claude:${SESSION_ID}`, "--json", "--no-gitignore"]);

    const stdout = await runWithInput(
      ["bootstrap", "--hook-agent", "claude"],
      projectPath,
      HOOK_EVENT
    );
    expect(stdout).toContain('<hamma-project-memory name="bootstrap-thread"');
    expect(stdout).toContain("untrusted historical state");
    expect(stdout).toContain("Git drift:");
    expect(stdout).toContain("Hamma Repository Memory");
    expect(stdout.trimEnd().endsWith("</hamma-project-memory>")).toBe(true);
  }, 20_000);

  it("emits the same context through a native Codex SessionStart hook", async () => {
    const stdout = await runWithInput(
      ["bootstrap", "--hook-agent", "codex"],
      projectPath,
      HOOK_EVENT
    );
    expect(stdout).toContain('<hamma-project-memory name="bootstrap-thread"');
    expect(stdout).toContain("untrusted historical state");
    expect(stdout.trimEnd().endsWith("</hamma-project-memory>")).toBe(true);
  });

  it("returns a machine-readable ready result with --json", async () => {
    const result = JSON.parse(await run(["bootstrap", "--json"]));
    expect(result).toMatchObject({
      schemaVersion: 1,
      status: "ready",
      memory: "bootstrap-thread",
      executionMode: "continue_work",
      truncated: false,
    });
    expect(result.bytes).toBeGreaterThan(0);
    expect(result.bytes).toBeLessThanOrEqual(8192 + 1024);
    expect(result.context).toContain("Recorded next action:");
  });

  it("skips silently while an open attach claim exists", async () => {
    const attached = JSON.parse(await run([
      "memory", "attach", "bootstrap-thread", "--to", "codex", "--no-sync", "--json",
    ]));
    expect(attached.attachId).toBeTruthy();
    try {
      const stdout = await runWithInput(
        ["bootstrap", "--hook-agent", "claude"],
        projectPath,
        HOOK_EVENT
      );
      expect(stdout).toBe("");
      const result = JSON.parse(await run(["bootstrap", "--json"]));
      expect(result).toMatchObject({ status: "skipped", reason: "open-attach-claim" });
    } finally {
      await run([
        "memory", "abandon", "bootstrap-thread",
        "--attach", attached.attachId, "--reason", "test cleanup", "--json",
      ]);
    }
  }, 20_000);

  it("frames a completed epoch as ready_for_input without a next action", async () => {
    await writeSession(true);
    await run(["memory", "sync", "--source", `claude:${SESSION_ID}`, "--json", "--no-gitignore"]);
    const result = JSON.parse(await run(["bootstrap", "--json"]));
    expect(result).toMatchObject({ status: "ready", executionMode: "ready_for_input" });
    expect(result.context).not.toContain("Recorded next action");
    expect(result.context).toContain("wait for the user's next instruction");
  }, 20_000);

  it("truncates an oversized bootstrap.md under the byte cap", async () => {
    const shown = JSON.parse(await run(["memory", "show", "--json"]));
    const revisionPath = shown.latest.revisionPath;
    const bootstrapPath = path.join(revisionPath, "bootstrap.md");
    const original = await fs.readFile(bootstrapPath, "utf8");
    try {
      await fs.writeFile(bootstrapPath, `${"y".repeat(80)}\n`.repeat(200));
      const result = JSON.parse(await run(["bootstrap", "--json"]));
      expect(result.truncated).toBe(true);
      expect(result.context).toContain("[… truncated at 8192 bytes");
      expect(result.bytes).toBeLessThan(8192 + 1024);
    } finally {
      await fs.writeFile(bootstrapPath, original);
    }
  });

  it("tolerates empty stdin in hook mode", async () => {
    const stdout = await runWithInput(
      ["bootstrap", "--hook-agent", "claude"],
      projectPath,
      ""
    );
    expect(stdout).toContain("<hamma-project-memory");
  });

  it("exits 0 with no output in hook mode when memory metadata is corrupted", async () => {
    const manifestPath = path.join(
      projectPath, ".hamma", "memories", "bootstrap-thread", "memory.json"
    );
    const original = await fs.readFile(manifestPath, "utf8");
    try {
      await fs.writeFile(manifestPath, "{ not valid json\n");
      const stdout = await runWithInput(
        ["bootstrap", "--hook-agent", "claude"],
        projectPath,
        HOOK_EVENT
      );
      expect(stdout).toBe("");
    } finally {
      await fs.writeFile(manifestPath, original);
    }
  });

  it("works in a plain directory without git", async () => {
    const plainDir = path.join(fixtureRoot, "plain");
    await fs.mkdir(plainDir, { recursive: true });
    const result = JSON.parse(await run(["bootstrap", "--json"], plainDir));
    expect(result).toMatchObject({ status: "skipped", reason: "memory-not-enabled" });
  });
});

describe("bootstrap modes", () => {
  beforeAll(async () => {
    await run(["config", "set", "bootstrap", "manual"]);
  });

  it("manual mode keeps hook-driven context out of plain sessions", async () => {
    const stdout = await runWithInput(
      ["bootstrap", "--hook-agent", "claude"],
      projectPath,
      HOOK_EVENT
    );
    expect(stdout).toBe("");
    const json = JSON.parse(await runWithInput(
      ["bootstrap", "--hook-agent", "claude", "--json"],
      projectPath,
      HOOK_EVENT
    ));
    expect(json).toMatchObject({ status: "skipped", reason: "manual-mode" });
  });

  it("manual mode still injects context for hamma-launched sessions", async () => {
    const stdout = await runWithInput(
      ["bootstrap", "--hook-agent", "claude"],
      projectPath,
      HOOK_EVENT,
      { HAMMA_CLAUDE_LAUNCH_ID: "00000000-0000-4000-8000-000000000000" }
    );
    expect(stdout).toContain('<hamma-project-memory name="bootstrap-thread"');
    expect(stdout.trimEnd().endsWith("</hamma-project-memory>")).toBe(true);
  });

  it("manual mode does not gate the lifecycle sync hook", async () => {
    await expect(runWithInput(
      ["memory", "sync", "--hook-agent", "claude", "--no-gitignore"],
      projectPath,
      HOOK_EVENT
    )).resolves.toBeDefined();
  });

  it("manual mode does not gate an explicit non-hook bootstrap", async () => {
    const result = JSON.parse(await run(["bootstrap", "--json"]));
    expect(result).toMatchObject({ status: "ready", memory: "bootstrap-thread" });
  });

  it("defaults to manual when the config file is corrupted", async () => {
    const configPath = path.join(projectPath, ".hamma", "config.json");
    const original = await fs.readFile(configPath, "utf8");
    try {
      await fs.writeFile(configPath, "{ not valid json\n");
      const stdout = await runWithInput(
        ["bootstrap", "--hook-agent", "claude"],
        projectPath,
        HOOK_EVENT
      );
      expect(stdout).toBe("");
    } finally {
      await fs.writeFile(configPath, original);
    }
  });
});

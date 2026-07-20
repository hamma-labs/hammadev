import { randomUUID } from "node:crypto";
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

let fixtureRoot = "";
let projectPath = "";
let codexHome = "";
let fakeHome = "";
let fakeCodexScript = "";
let fakeCodexBin = "";

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: fakeHome,
    CODEX_HOME: codexHome,
    HAMMA_TEST_TSX: TSX,
    HAMMA_TEST_CLI: CLI,
    HAMMA_TEST_NODE: process.execPath,
    HAMMA_TEST_FAKE_CODEX: fakeCodexScript,
    ...overrides,
  };
}

async function run(args: string[], cwd = projectPath): Promise<string> {
  const result = await execFileAsync(TSX, [CLI, ...args], {
    cwd,
    env: environment(),
  });
  return result.stdout;
}

async function runWithInput(
  args: string[],
  cwd: string,
  input: string,
  envOverrides: NodeJS.ProcessEnv = {}
): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(TSX, [CLI, ...args], {
      cwd,
      env: environment(envOverrides),
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
    child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve(stdout);
      else reject(new Error(`CLI exited ${code}: ${stderr}`));
    });
    child.stdin.end(input);
  });
}

async function waitForFile(target: string): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    try {
      await fs.access(target);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
  throw new Error(`Timed out waiting for ${target}`);
}

async function writeCodexSession(
  targetProject: string,
  sessionId: string,
  timestamp = "15-00-00"
): Promise<string> {
  const target = path.join(
    codexHome,
    "sessions",
    "2026",
    "07",
    "20",
    `rollout-2026-07-20T${timestamp}-${sessionId}.jsonl`
  );
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, [
    { type: "session_meta", payload: { id: sessionId, cwd: targetProject, timestamp: "2026-07-20T15:00:00Z" } },
    { type: "event_msg", timestamp: "2026-07-20T15:00:01Z", payload: { type: "user_message", message: "Recover this exact interrupted Codex session." } },
    { type: "event_msg", timestamp: "2026-07-20T15:00:02Z", payload: { type: "agent_message", message: "Recovery remains. Next verify next-start synchronization." } },
  ].map((record) => JSON.stringify(record)).join("\n") + "\n");
  return target;
}

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-cli-codex-"));
  projectPath = path.join(fixtureRoot, "project");
  codexHome = path.join(fixtureRoot, "codex-home");
  fakeHome = path.join(fixtureRoot, "home");
  fakeCodexScript = path.join(fixtureRoot, "fake-codex.mjs");
  fakeCodexBin = path.join(fixtureRoot, "bin", "codex");
  await fs.mkdir(projectPath, { recursive: true });
  await fs.mkdir(path.dirname(fakeCodexBin), { recursive: true });
  await execFileAsync("git", ["-C", projectPath, "init", "-q"]);
  await execFileAsync("git", ["-C", projectPath, "config", "user.email", "wrapper@example.test"]);
  await execFileAsync("git", ["-C", projectPath, "config", "user.name", "Wrapper Test"]);
  await fs.writeFile(path.join(projectPath, "README.md"), "wrapper fixture\n");
  await execFileAsync("git", ["-C", projectPath, "add", "README.md"]);
  await execFileAsync("git", ["-C", projectPath, "commit", "-qm", "initial"]);
  await fs.writeFile(fakeCodexScript, `
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const sessionId = process.env.HAMMA_TEST_SESSION_ID;
const codexHome = process.env.CODEX_HOME;
const project = process.cwd();
const sessionPath = path.join(
  codexHome,
  "sessions",
  "2026",
  "07",
  "20",
  \`rollout-2026-07-20T14-00-00-\${sessionId}.jsonl\`
);
fs.mkdirSync(path.dirname(sessionPath), { recursive: true });
const records = [
  { type: "session_meta", payload: { id: sessionId, cwd: project, timestamp: "2026-07-20T14:00:00Z" } },
  { type: "event_msg", timestamp: "2026-07-20T14:00:01Z", payload: { type: "user_message", message: "Implement reliable wrapper checkpointing." } },
  { type: "event_msg", timestamp: "2026-07-20T14:00:02Z", payload: { type: "agent_message", message: \`Work remains for \${sessionId}. Next verify the wrapper checkpoint.\` } },
];
fs.writeFileSync(sessionPath, records.map((record) => JSON.stringify(record)).join("\\n") + "\\n");
const hook = spawnSync(
  process.env.HAMMA_TEST_TSX,
  [process.env.HAMMA_TEST_CLI, "bootstrap", "--hook-agent", "codex"],
  {
    cwd: project,
    env: process.env,
    input: JSON.stringify({
      session_id: sessionId,
      transcript_path: sessionPath,
      hook_event_name: "SessionStart",
      source: "startup",
    }),
    encoding: "utf8",
  }
);
if (hook.status !== 0) {
  process.stderr.write(hook.stderr || "fake Codex SessionStart failed\\n");
  process.exit(90);
}
if (process.env.HAMMA_TEST_ARGS_FILE) {
  fs.writeFileSync(process.env.HAMMA_TEST_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
}
if (process.env.HAMMA_TEST_READY_FILE) {
  fs.writeFileSync(process.env.HAMMA_TEST_READY_FILE, "ready\\n");
  setInterval(() => {}, 1000);
} else {
  process.exit(Number(process.env.HAMMA_TEST_EXIT_CODE || "0"));
}
`.trimStart());
  await fs.writeFile(fakeCodexBin, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then echo 'fake-codex 1.0.0'; exit 0; fi",
    "exec \"$HAMMA_TEST_NODE\" \"$HAMMA_TEST_FAKE_CODEX\" \"$@\"",
    "",
  ].join("\n"));
  await fs.chmod(fakeCodexBin, 0o755);
}, 30_000);

afterAll(async () => {
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("hamma codex", () => {
  it("forwards Codex arguments and checkpoints the exact session on normal exit", async () => {
    const sessionId = "cli-wrapper-normal";
    const argsFile = path.join(fixtureRoot, "forwarded-args.json");
    await run(["memory", "start", "default", "--no-gitignore", "--json"]);
    const result = await execFileAsync(
      TSX,
      [
        CLI,
        "codex",
        "--project",
        projectPath,
        "--codex-bin",
        process.execPath,
        "--",
        fakeCodexScript,
        "--model",
        "test-model",
      ],
      {
        cwd: projectPath,
        env: environment({
          HAMMA_TEST_SESSION_ID: sessionId,
          HAMMA_TEST_ARGS_FILE: argsFile,
        }),
      }
    );
    expect(result.stderr).toContain(`Hamma saved Codex session ${sessionId}`);
    expect(JSON.parse(await fs.readFile(argsFile, "utf8"))).toEqual([
      "--model",
      "test-model",
    ]);
    const inspection = JSON.parse(await run(["memory", "show", "default", "--json"]));
    expect(inspection.latest.revision.sourceSessionId).toBe(sessionId);
    expect(inspection.latest.state.nextAction).toContain("reliable wrapper checkpointing");
    expect(await fs.readdir(path.join(projectPath, ".hamma", "runtime", "codex")))
      .toEqual([]);
  }, 30_000);

  it("checkpoints after a non-zero child exit and preserves the child exit code", async () => {
    const sessionId = "cli-wrapper-crash";
    await expect(execFileAsync(
      TSX,
      [
        CLI,
        "codex",
        "--project",
        projectPath,
        "--codex-bin",
        process.execPath,
        "--",
        fakeCodexScript,
      ],
      {
        cwd: projectPath,
        env: environment({
          HAMMA_TEST_SESSION_ID: sessionId,
          HAMMA_TEST_EXIT_CODE: "23",
        }),
      }
    )).rejects.toMatchObject({ code: 23 });
    const inspection = JSON.parse(await run(["memory", "show", "default", "--json"]));
    expect(inspection.latest.revision.sourceSessionId).toBe(sessionId);
  }, 30_000);

  it("forwards SIGTERM to Codex, then checkpoints before preserving signal exit status", async () => {
    const sessionId = "cli-wrapper-signal";
    const readyFile = path.join(fixtureRoot, "signal-ready");
    const child = spawn(
      TSX,
      [
        CLI,
        "codex",
        "--project",
        projectPath,
        "--codex-bin",
        process.execPath,
        "--",
        fakeCodexScript,
      ],
      {
        cwd: projectPath,
        env: environment({
          HAMMA_TEST_SESSION_ID: sessionId,
          HAMMA_TEST_READY_FILE: readyFile,
        }),
        stdio: ["ignore", "pipe", "pipe"],
      }
    );
    await waitForFile(readyFile);
    const close = new Promise<number | null>((resolve, reject) => {
      child.once("error", reject);
      child.once("close", (code) => resolve(code));
    });
    child.kill("SIGTERM");
    const exitCode = await close;
    expect(exitCode).toBe(143);
    const inspection = JSON.parse(await run(["memory", "show", "default", "--json"]));
    expect(inspection.latest.revision.sourceSessionId).toBe(sessionId);
  }, 30_000);

  it("recovers an unclean Codex launch before another agent receives bootstrap", async () => {
    const recoveryProject = path.join(fixtureRoot, "recovery-project");
    const sessionId = "cli-next-start-recovery";
    await fs.mkdir(recoveryProject, { recursive: true });
    await execFileAsync("git", ["-C", recoveryProject, "init", "-q"]);
    await execFileAsync("git", ["-C", recoveryProject, "config", "user.email", "recovery@example.test"]);
    await execFileAsync("git", ["-C", recoveryProject, "config", "user.name", "Recovery Test"]);
    await fs.writeFile(path.join(recoveryProject, "README.md"), "recovery fixture\n");
    await execFileAsync("git", ["-C", recoveryProject, "add", "README.md"]);
    await execFileAsync("git", ["-C", recoveryProject, "commit", "-qm", "initial"]);
    await run([
      "memory", "start", "default", "--project", recoveryProject,
      "--no-gitignore", "--json",
    ], recoveryProject);
    await writeCodexSession(recoveryProject, sessionId);

    const runtimeRoot = path.join(recoveryProject, ".hamma", "runtime", "codex");
    await fs.mkdir(runtimeRoot, { recursive: true });
    const launchId = randomUUID();
    const now = new Date().toISOString();
    await fs.writeFile(
      path.join(runtimeRoot, `${launchId}.json`),
      `${JSON.stringify({
        schemaVersion: 1,
        id: launchId,
        projectPath: recoveryProject,
        memory: "default",
        wrapperPid: 2_147_483_647,
        childPid: 2_147_483_646,
        sessionId,
        state: "failed",
        createdAt: now,
        updatedAt: now,
        checkpointAttempts: 0,
      }, null, 2)}\n`
    );

    const stdout = await runWithInput(
      ["bootstrap", "--hook-agent", "claude", "--project", recoveryProject],
      recoveryProject,
      JSON.stringify({ session_id: "claude-start", hook_event_name: "SessionStart" })
    );
    expect(stdout).toContain('<hamma-project-memory name="default"');
    const inspection = JSON.parse(await run([
      "memory", "show", "default", "--project", recoveryProject, "--json",
    ], recoveryProject));
    expect(inspection.latest.revision.sourceSessionId).toBe(sessionId);
    expect(await fs.readdir(runtimeRoot)).toEqual([]);
  }, 30_000);

  it("routes `hamma switch codex` through the reliable wrapper", async () => {
    const switchProject = path.join(fixtureRoot, "switch-project");
    const claudeSessionId = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
    const codexSessionId = "cli-switch-native-codex";
    await fs.mkdir(switchProject, { recursive: true });
    await execFileAsync("git", ["-C", switchProject, "init", "-q"]);
    await execFileAsync("git", ["-C", switchProject, "config", "user.email", "switch@example.test"]);
    await execFileAsync("git", ["-C", switchProject, "config", "user.name", "Switch Test"]);
    await fs.writeFile(path.join(switchProject, "README.md"), "switch fixture\n");
    await execFileAsync("git", ["-C", switchProject, "add", "README.md"]);
    await execFileAsync("git", ["-C", switchProject, "commit", "-qm", "initial"]);
    const claudePath = path.join(
      fakeHome,
      ".claude",
      "projects",
      "switch-project",
      `${claudeSessionId}.jsonl`
    );
    await fs.mkdir(path.dirname(claudePath), { recursive: true });
    await fs.writeFile(claudePath, [
      {
        type: "user",
        uuid: "switch-user",
        sessionId: claudeSessionId,
        cwd: switchProject,
        timestamp: "2026-07-20T16:00:00Z",
        message: { role: "user", content: "Implement the native Codex switch path." },
      },
      {
        type: "assistant",
        uuid: "switch-assistant",
        sessionId: claudeSessionId,
        timestamp: "2026-07-20T16:00:01Z",
        message: { role: "assistant", content: "Work remains. Next continue in Codex." },
      },
    ].map((record) => JSON.stringify(record)).join("\n") + "\n");

    const result = await execFileAsync(
      TSX,
      [
        CLI,
        "switch",
        "codex",
        "--from",
        "claude",
        "--memory",
        "switch-native",
        "--project",
        switchProject,
        "--start",
        "--no-gitignore",
      ],
      {
        cwd: switchProject,
        env: environment({
          PATH: `${path.dirname(fakeCodexBin)}:${process.env.PATH ?? ""}`,
          HAMMA_TEST_SESSION_ID: codexSessionId,
        }),
      }
    );
    expect(result.stderr).toContain(`Hamma saved Codex session ${codexSessionId}`);
    const inspection = JSON.parse(await run([
      "memory", "show", "switch-native", "--project", switchProject, "--json",
    ], switchProject));
    expect(inspection.latest.revision.sourceSessionId).toBe(codexSessionId);
    expect(inspection.openRuns[0]).toMatchObject({
      targetCli: "codex",
      status: "running",
      targetSessionId: codexSessionId,
    });
  }, 30_000);

  it("launches Codex without creating runtime state when memory is disabled", async () => {
    const plainProject = path.join(fixtureRoot, "plain-project");
    await fs.mkdir(plainProject, { recursive: true });
    const result = await execFileAsync(
      TSX,
      [
        CLI,
        "codex",
        "--project",
        plainProject,
        "--codex-bin",
        process.execPath,
        "--",
        fakeCodexScript,
      ],
      {
        cwd: plainProject,
        env: environment({ HAMMA_TEST_SESSION_ID: "cli-wrapper-disabled" }),
      }
    );
    expect(result.stderr).toContain("No active project memory");
    await expect(fs.access(path.join(plainProject, ".hamma"))).rejects.toThrow();
  }, 30_000);
});

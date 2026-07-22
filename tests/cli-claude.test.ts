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
let fakeClaudeScript = "";
let fakeClaudeBin = "";

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: fakeHome,
    CODEX_HOME: codexHome,
    HAMMA_TEST_TSX: TSX,
    HAMMA_TEST_CLI: CLI,
    HAMMA_TEST_NODE: process.execPath,
    HAMMA_TEST_FAKE_CLAUDE: fakeClaudeScript,
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

async function initGitProject(target: string, marker: string): Promise<void> {
  await fs.mkdir(target, { recursive: true });
  await execFileAsync("git", ["-C", target, "init", "-q"]);
  await execFileAsync("git", ["-C", target, "config", "user.email", "claude-wrapper@example.test"]);
  await execFileAsync("git", ["-C", target, "config", "user.name", "Claude Wrapper Test"]);
  await fs.writeFile(path.join(target, "README.md"), `${marker}\n`);
  await execFileAsync("git", ["-C", target, "add", "README.md"]);
  await execFileAsync("git", ["-C", target, "commit", "-qm", "initial"]);
}

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-cli-claude-"));
  projectPath = path.join(fixtureRoot, "project");
  codexHome = path.join(fixtureRoot, "codex-home");
  fakeHome = path.join(fixtureRoot, "home");
  fakeClaudeScript = path.join(fixtureRoot, "fake-claude.mjs");
  fakeClaudeBin = path.join(fixtureRoot, "bin", "claude");
  await fs.mkdir(path.dirname(fakeClaudeBin), { recursive: true });
  await initGitProject(projectPath, "claude wrapper fixture");
  await fs.writeFile(fakeClaudeScript, `
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const sessionId = process.env.HAMMA_TEST_SESSION_ID;
const project = process.cwd();
const projectDir = path.join(process.env.HOME, ".claude", "projects", "wrapper-project");
const sessionPath = path.join(projectDir, \`\${sessionId}.jsonl\`);
fs.mkdirSync(projectDir, { recursive: true });
const records = [
  {
    type: "user",
    uuid: \`user-\${sessionId}\`,
    sessionId,
    cwd: project,
    timestamp: "2026-07-20T14:00:00Z",
    message: { role: "user", content: "Implement reliable Claude wrapper checkpointing." },
  },
  {
    type: "assistant",
    uuid: \`assistant-\${sessionId}\`,
    sessionId,
    timestamp: "2026-07-20T14:00:01Z",
    message: { role: "assistant", content: \`Work remains for \${sessionId}. Next verify the Claude wrapper checkpoint.\` },
  },
];
fs.writeFileSync(sessionPath, records.map((record) => JSON.stringify(record)).join("\\n") + "\\n");
const hook = spawnSync(
  process.env.HAMMA_TEST_TSX,
  [process.env.HAMMA_TEST_CLI, "bootstrap", "--hook-agent", "claude"],
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
  process.stderr.write(hook.stderr || "fake Claude SessionStart failed\\n");
  process.exit(90);
}
if (process.env.HAMMA_TEST_ARGS_FILE) {
  fs.writeFileSync(process.env.HAMMA_TEST_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
}
process.exit(Number(process.env.HAMMA_TEST_EXIT_CODE || "0"));
`.trimStart());
  await fs.writeFile(fakeClaudeBin, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then echo 'fake-claude 1.0.0'; exit 0; fi",
    "exec \"$HAMMA_TEST_NODE\" \"$HAMMA_TEST_FAKE_CLAUDE\" \"$@\"",
    "",
  ].join("\n"));
  await fs.chmod(fakeClaudeBin, 0o755);
}, 30_000);

afterAll(async () => {
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("hamma claude", () => {
  it("forwards Claude arguments, installs native hooks, and checkpoints the exact session on exit", async () => {
    const sessionId = "aaaaaaaa-0001-4aaa-8aaa-aaaaaaaaaaaa";
    const argsFile = path.join(fixtureRoot, "forwarded-args.json");
    await run(["memory", "start", "default", "--no-gitignore", "--json"]);
    const result = await execFileAsync(
      TSX,
      [
        CLI,
        "claude",
        "--project",
        projectPath,
        "--claude-bin",
        process.execPath,
        "--",
        fakeClaudeScript,
        "--continue",
      ],
      {
        cwd: projectPath,
        env: environment({
          HAMMA_TEST_SESSION_ID: sessionId,
          HAMMA_TEST_ARGS_FILE: argsFile,
        }),
      }
    );
    expect(result.stderr).toContain(`Hamma saved Claude Code session ${sessionId}`);
    expect(JSON.parse(await fs.readFile(argsFile, "utf8"))).toEqual(["--continue"]);
    const settings = JSON.parse(await fs.readFile(
      path.join(projectPath, ".claude", "settings.local.json"),
      "utf8"
    ));
    expect(Object.keys(settings.hooks)).toEqual(
      expect.arrayContaining(["PreCompact", "SessionEnd", "SessionStart"])
    );
    const inspection = JSON.parse(await run(["memory", "show", "default", "--json"]));
    expect(inspection.latest.revision.sourceSessionId).toBe(sessionId);
    expect(inspection.latest.state.nextAction).toContain("Claude wrapper checkpoint");
    expect(await fs.readdir(path.join(projectPath, ".hamma", "runtime", "claude")))
      .toEqual([]);
  }, 30_000);

  it("checkpoints after a non-zero child exit and preserves the child exit code", async () => {
    const sessionId = "aaaaaaaa-0002-4aaa-8aaa-aaaaaaaaaaaa";
    await expect(execFileAsync(
      TSX,
      [
        CLI,
        "claude",
        "--project",
        projectPath,
        "--claude-bin",
        process.execPath,
        "--",
        fakeClaudeScript,
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

  it("routes `hamma switch claude` through the reliable wrapper", async () => {
    const switchProject = path.join(fixtureRoot, "switch-project");
    const codexSessionId = "cli-switch-source-codex";
    const claudeSessionId = "aaaaaaaa-0003-4aaa-8aaa-aaaaaaaaaaaa";
    const argsFile = path.join(fixtureRoot, "switch-claude-args.json");
    await initGitProject(switchProject, "switch fixture");
    const codexPath = path.join(
      codexHome,
      "sessions",
      "2026",
      "07",
      "20",
      `rollout-2026-07-20T15-00-00-${codexSessionId}.jsonl`
    );
    await fs.mkdir(path.dirname(codexPath), { recursive: true });
    await fs.writeFile(codexPath, [
      { type: "session_meta", payload: { id: codexSessionId, cwd: switchProject, timestamp: "2026-07-20T15:00:00Z" } },
      { type: "event_msg", timestamp: "2026-07-20T15:00:01Z", payload: { type: "user_message", message: "Implement the native Claude switch path." } },
      { type: "event_msg", timestamp: "2026-07-20T15:00:02Z", payload: { type: "agent_message", message: "Work remains. Next continue in Claude." } },
    ].map((record) => JSON.stringify(record)).join("\n") + "\n");

    const result = await execFileAsync(
      TSX,
      [
        CLI,
        "switch",
        "claude",
        "--from",
        "codex",
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
          PATH: `${path.dirname(fakeClaudeBin)}:${process.env.PATH ?? ""}`,
          HAMMA_TEST_SESSION_ID: claudeSessionId,
          HAMMA_TEST_ARGS_FILE: argsFile,
        }),
      }
    );
    expect(result.stderr).toContain(`Hamma saved Claude Code session ${claudeSessionId}`);
    expect(JSON.parse(await fs.readFile(argsFile, "utf8"))).toEqual([]);
    const inspection = JSON.parse(await run([
      "memory", "show", "switch-native", "--project", switchProject, "--json",
    ], switchProject));
    expect(inspection.latest.revision.sourceSessionId).toBe(claudeSessionId);
    expect(inspection.openRuns[0]).toMatchObject({
      targetCli: "claude",
      status: "running",
      targetSessionId: claudeSessionId,
    });
  }, 30_000);

  it("suggests `hamma claude` when attaching memory for Claude", async () => {
    const attachProject = path.join(fixtureRoot, "attach-project");
    const codexSessionId = "cli-attach-source-codex";
    await initGitProject(attachProject, "attach fixture");
    const codexPath = path.join(
      codexHome,
      "sessions",
      "2026",
      "07",
      "20",
      `rollout-2026-07-20T15-10-00-${codexSessionId}.jsonl`
    );
    await fs.mkdir(path.dirname(codexPath), { recursive: true });
    await fs.writeFile(codexPath, [
      { type: "session_meta", payload: { id: codexSessionId, cwd: attachProject, timestamp: "2026-07-20T15:10:00Z" } },
      { type: "event_msg", timestamp: "2026-07-20T15:10:01Z", payload: { type: "user_message", message: "Prepare the attach fixture." } },
      { type: "event_msg", timestamp: "2026-07-20T15:10:02Z", payload: { type: "agent_message", message: "Work remains. Next attach in Claude." } },
    ].map((record) => JSON.stringify(record)).join("\n") + "\n");
    await run([
      "memory", "start", "attach-fixture", "--project", attachProject,
      "--no-gitignore", "--json",
    ], attachProject);
    await run([
      "memory", "sync", "attach-fixture", "--source", `codex:${codexSessionId}`,
      "--project", attachProject, "--no-gitignore", "--json",
    ], attachProject);
    const attached = JSON.parse(await run([
      "memory", "attach", "attach-fixture", "--to", "claude", "--no-sync",
      "--project", attachProject, "--json",
    ], attachProject));
    expect(attached.suggestedCommand).toContain("hamma claude --memory \"attach-fixture\" --");
  }, 30_000);

  it("launches Claude without creating runtime state when memory is disabled", async () => {
    const plainProject = path.join(fixtureRoot, "plain-project");
    await fs.mkdir(plainProject, { recursive: true });
    const result = await execFileAsync(
      TSX,
      [
        CLI,
        "claude",
        "--project",
        plainProject,
        "--claude-bin",
        process.execPath,
        "--",
        fakeClaudeScript,
      ],
      {
        cwd: plainProject,
        env: environment({ HAMMA_TEST_SESSION_ID: "aaaaaaaa-0004-4aaa-8aaa-aaaaaaaaaaaa" }),
      }
    );
    expect(result.stderr).toContain("No active project memory");
    await expect(fs.access(path.join(plainProject, ".hamma"))).rejects.toThrow();
    await expect(fs.access(path.join(plainProject, ".claude"))).rejects.toThrow();
  }, 30_000);
});

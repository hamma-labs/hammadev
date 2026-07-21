import { execFile } from "node:child_process";
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
let grokHome = "";
let fakeHome = "";
let fakeGrokScript = "";
let fakeGrokBin = "";

function environment(overrides: NodeJS.ProcessEnv = {}): NodeJS.ProcessEnv {
  return {
    ...process.env,
    HOME: fakeHome,
    CODEX_HOME: codexHome,
    GROK_HOME: grokHome,
    HAMMA_TEST_TSX: TSX,
    HAMMA_TEST_CLI: CLI,
    HAMMA_TEST_NODE: process.execPath,
    HAMMA_TEST_FAKE_GROK: fakeGrokScript,
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
  await execFileAsync("git", ["-C", target, "config", "user.email", "grok-wrapper@example.test"]);
  await execFileAsync("git", ["-C", target, "config", "user.name", "Grok Wrapper Test"]);
  await fs.writeFile(path.join(target, "README.md"), `${marker}\n`);
  await execFileAsync("git", ["-C", target, "add", "README.md"]);
  await execFileAsync("git", ["-C", target, "commit", "-qm", "initial"]);
}

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-cli-grok-"));
  projectPath = path.join(fixtureRoot, "project");
  codexHome = path.join(fixtureRoot, "codex-home");
  grokHome = path.join(fixtureRoot, "grok-home");
  fakeHome = path.join(fixtureRoot, "home");
  fakeGrokScript = path.join(fixtureRoot, "fake-grok.mjs");
  fakeGrokBin = path.join(fixtureRoot, "bin", "grok");
  await fs.mkdir(path.dirname(fakeGrokBin), { recursive: true });
  await initGitProject(projectPath, "grok wrapper fixture");
  await fs.writeFile(fakeGrokScript, `
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const sessionId = process.env.HAMMA_TEST_SESSION_ID;
const project = process.cwd();
const sessionDir = path.join(process.env.GROK_HOME, "sessions", "wrapper-project", sessionId);
fs.mkdirSync(sessionDir, { recursive: true });
fs.writeFileSync(path.join(sessionDir, "summary.json"), JSON.stringify({
  info: { id: sessionId, cwd: project },
  created_at: "2026-07-21T09:00:00Z",
  updated_at: "2026-07-21T09:00:02Z",
}) + "\\n");
const records = [
  { type: "user", content: "Implement reliable Grok wrapper checkpointing.", ts: "2026-07-21T09:00:00Z" },
  { type: "assistant", content: \`Work remains for \${sessionId}. Next verify the Grok wrapper checkpoint.\`, ts: "2026-07-21T09:00:01Z" },
];
fs.writeFileSync(
  path.join(sessionDir, "chat_history.jsonl"),
  records.map((record) => JSON.stringify(record)).join("\\n") + "\\n"
);
const hook = spawnSync(
  process.env.HAMMA_TEST_TSX,
  [process.env.HAMMA_TEST_CLI, "bootstrap", "--hook-agent", "grok"],
  {
    cwd: project,
    env: process.env,
    input: JSON.stringify({
      session_id: sessionId,
      hook_event_name: "SessionStart",
      source: "startup",
    }),
    encoding: "utf8",
  }
);
if (hook.status !== 0) {
  process.stderr.write(hook.stderr || "fake Grok SessionStart failed\\n");
  process.exit(90);
}
if (process.env.HAMMA_TEST_ARGS_FILE) {
  fs.writeFileSync(process.env.HAMMA_TEST_ARGS_FILE, JSON.stringify(process.argv.slice(2)));
}
process.exit(Number(process.env.HAMMA_TEST_EXIT_CODE || "0"));
`.trimStart());
  await fs.writeFile(fakeGrokBin, [
    "#!/bin/sh",
    "if [ \"$1\" = \"--version\" ]; then echo 'fake-grok 1.0.0'; exit 0; fi",
    "exec \"$HAMMA_TEST_NODE\" \"$HAMMA_TEST_FAKE_GROK\" \"$@\"",
    "",
  ].join("\n"));
  await fs.chmod(fakeGrokBin, 0o755);
}, 30_000);

afterAll(async () => {
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("hamma grok", () => {
  it("forwards Grok arguments, installs native hooks, and checkpoints the exact session on exit", async () => {
    const sessionId = "grok-session-0001";
    const argsFile = path.join(fixtureRoot, "forwarded-args.json");
    await run(["memory", "start", "default", "--no-gitignore", "--json"]);
    const result = await execFileAsync(
      TSX,
      [
        CLI,
        "grok",
        "--project",
        projectPath,
        "--grok-bin",
        process.execPath,
        "--",
        fakeGrokScript,
        "--resume",
      ],
      {
        cwd: projectPath,
        env: environment({
          HAMMA_TEST_SESSION_ID: sessionId,
          HAMMA_TEST_ARGS_FILE: argsFile,
        }),
      }
    );
    expect(result.stderr).toContain(`Hamma saved Grok session ${sessionId}`);
    expect(JSON.parse(await fs.readFile(argsFile, "utf8"))).toEqual(["--resume"]);
    const hooks = JSON.parse(await fs.readFile(
      path.join(projectPath, ".grok", "hooks", "hamma-memory.json"),
      "utf8"
    ));
    expect(Object.keys(hooks.hooks)).toEqual(
      expect.arrayContaining(["PreCompact", "SessionEnd", "SessionStart"])
    );
    const inspection = JSON.parse(await run(["memory", "show", "default", "--json"]));
    expect(inspection.latest.revision.sourceSessionId).toBe(sessionId);
    expect(inspection.latest.state.nextAction).toContain("Grok wrapper checkpoint");
    expect(await fs.readdir(path.join(projectPath, ".hamma", "runtime", "grok")))
      .toEqual([]);
  }, 30_000);

  it("checkpoints after a non-zero child exit and preserves the child exit code", async () => {
    const sessionId = "grok-session-0002";
    await expect(execFileAsync(
      TSX,
      [
        CLI,
        "grok",
        "--project",
        projectPath,
        "--grok-bin",
        process.execPath,
        "--",
        fakeGrokScript,
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

  it("routes `hamma switch grok` through the reliable wrapper", async () => {
    const switchProject = path.join(fixtureRoot, "switch-project");
    const codexSessionId = "cli-switch-source-codex";
    const grokSessionId = "grok-session-0003";
    await initGitProject(switchProject, "switch fixture");
    const codexPath = path.join(
      codexHome,
      "sessions",
      "2026",
      "07",
      "21",
      `rollout-2026-07-21T09-30-00-${codexSessionId}.jsonl`
    );
    await fs.mkdir(path.dirname(codexPath), { recursive: true });
    await fs.writeFile(codexPath, [
      { type: "session_meta", payload: { id: codexSessionId, cwd: switchProject, timestamp: "2026-07-21T09:30:00Z" } },
      { type: "event_msg", timestamp: "2026-07-21T09:30:01Z", payload: { type: "user_message", message: "Implement the native Grok switch path." } },
      { type: "event_msg", timestamp: "2026-07-21T09:30:02Z", payload: { type: "agent_message", message: "Work remains. Next continue in Grok." } },
    ].map((record) => JSON.stringify(record)).join("\n") + "\n");

    const result = await execFileAsync(
      TSX,
      [
        CLI,
        "switch",
        "grok",
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
          PATH: `${path.dirname(fakeGrokBin)}:${process.env.PATH ?? ""}`,
          HAMMA_TEST_SESSION_ID: grokSessionId,
        }),
      }
    );
    expect(result.stderr).toContain(`Hamma saved Grok session ${grokSessionId}`);
    const inspection = JSON.parse(await run([
      "memory", "show", "switch-native", "--project", switchProject, "--json",
    ], switchProject));
    expect(inspection.latest.revision.sourceSessionId).toBe(grokSessionId);
    expect(inspection.openRuns[0]).toMatchObject({
      targetCli: "grok",
      status: "running",
      targetSessionId: grokSessionId,
    });
  }, 30_000);

  it("suggests `hamma grok` when attaching memory for Grok", async () => {
    const attachProject = path.join(fixtureRoot, "attach-project");
    const codexSessionId = "cli-attach-source-codex";
    await initGitProject(attachProject, "attach fixture");
    const codexPath = path.join(
      codexHome,
      "sessions",
      "2026",
      "07",
      "21",
      `rollout-2026-07-21T09-40-00-${codexSessionId}.jsonl`
    );
    await fs.mkdir(path.dirname(codexPath), { recursive: true });
    await fs.writeFile(codexPath, [
      { type: "session_meta", payload: { id: codexSessionId, cwd: attachProject, timestamp: "2026-07-21T09:40:00Z" } },
      { type: "event_msg", timestamp: "2026-07-21T09:40:01Z", payload: { type: "user_message", message: "Prepare the attach fixture." } },
      { type: "event_msg", timestamp: "2026-07-21T09:40:02Z", payload: { type: "agent_message", message: "Work remains. Next attach in Grok." } },
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
      "memory", "attach", "attach-fixture", "--to", "grok", "--no-sync",
      "--project", attachProject, "--json",
    ], attachProject));
    expect(attached.suggestedCommand).toContain("hamma grok --memory \"attach-fixture\" --");
  }, 30_000);

  it("launches Grok without creating runtime state when memory is disabled", async () => {
    const plainProject = path.join(fixtureRoot, "plain-project");
    await fs.mkdir(plainProject, { recursive: true });
    const result = await execFileAsync(
      TSX,
      [
        CLI,
        "grok",
        "--project",
        plainProject,
        "--grok-bin",
        process.execPath,
        "--",
        fakeGrokScript,
      ],
      {
        cwd: plainProject,
        env: environment({ HAMMA_TEST_SESSION_ID: "grok-session-0004" }),
      }
    );
    expect(result.stderr).toContain("No active project memory");
    await expect(fs.access(path.join(plainProject, ".hamma"))).rejects.toThrow();
    await expect(fs.access(path.join(plainProject, ".grok"))).rejects.toThrow();
  }, 30_000);
});

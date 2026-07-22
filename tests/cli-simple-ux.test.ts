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
const CODEX_ID = "simple-codex-session";
const CLAUDE_ID = "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb";

let fixtureRoot = "";
let projectPath = "";
let fakeHome = "";
let claudePath = "";

async function run(args: string[]): Promise<string> {
  const result = await execFileAsync(TSX, [CLI, ...args], {
    cwd: projectPath,
    env: { ...process.env, HOME: fakeHome },
  });
  return result.stdout;
}

async function setClaudeAttachMarker(attachId: string): Promise<void> {
  const content = await fs.readFile(claudePath, "utf8");
  await fs.writeFile(
    claudePath,
    content.replace(/\[HAMMA_ATTACH_ID:[0-9a-f-]+\]/, `[HAMMA_ATTACH_ID:${attachId}]`),
    "utf8"
  );
  const now = new Date();
  await fs.utimes(claudePath, now, now);
}

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-simple-ux-"));
  projectPath = path.join(fixtureRoot, "project");
  fakeHome = path.join(fixtureRoot, "home");
  await fs.mkdir(projectPath, { recursive: true });
  await execFileAsync("git", ["-C", projectPath, "init", "-q"]);
  await execFileAsync("git", ["-C", projectPath, "config", "user.email", "simple@example.test"]);
  await execFileAsync("git", ["-C", projectPath, "config", "user.name", "Simple UX Test"]);
  await fs.writeFile(path.join(projectPath, "README.md"), "simple UX fixture\n");
  await execFileAsync("git", ["-C", projectPath, "add", "README.md"]);
  await execFileAsync("git", ["-C", projectPath, "commit", "-qm", "initial"]);

  const codexPath = path.join(
    fakeHome,
    ".codex",
    "sessions",
    "2026",
    "07",
    "20",
    `rollout-2026-07-20T10-00-00-${CODEX_ID}.jsonl`
  );
  await fs.mkdir(path.dirname(codexPath), { recursive: true });
  await fs.writeFile(codexPath, [
    { type: "session_meta", payload: { session_id: CODEX_ID, cwd: projectPath, timestamp: "2026-07-20T10:00:00Z" } },
    { type: "event_msg", timestamp: "2026-07-20T10:00:01Z", payload: { type: "user_message", message: "Implement the simple CLI experience in src/cli.ts." } },
    { type: "event_msg", timestamp: "2026-07-20T10:00:02Z", payload: { type: "agent_message", message: "The CLI work remains. Next implement and verify the simple commands." } },
  ].map((record) => JSON.stringify(record)).join("\n") + "\n");

  claudePath = path.join(
    fakeHome,
    ".claude",
    "projects",
    "simple-project",
    `${CLAUDE_ID}.jsonl`
  );
  await fs.mkdir(path.dirname(claudePath), { recursive: true });
  await fs.writeFile(claudePath, [
    {
      type: "user", uuid: "u1", sessionId: CLAUDE_ID, cwd: projectPath,
      timestamp: "2026-07-20T10:01:00Z",
      message: { role: "user", content: "[HAMMA_ATTACH_ID:123e4567-e89b-42d3-a456-426614174000] Attach Hamma repository memory 'default'." },
    },
    {
      type: "user", uuid: "u2", sessionId: CLAUDE_ID, cwd: projectPath,
      timestamp: "2026-07-20T10:01:01Z",
      message: { role: "user", content: "Finish the transferred simple CLI work." },
    },
    {
      type: "assistant", uuid: "a1", sessionId: CLAUDE_ID,
      timestamp: "2026-07-20T10:01:02Z",
      message: { role: "assistant", content: "The transferred work is complete and tests passed." },
    },
  ].map((record) => JSON.stringify(record)).join("\n") + "\n");
});

afterAll(async () => {
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("simple CLI UX", () => {
  it("advertises the four-command workflow in help", async () => {
    const output = await run(["--help"]);
    expect(output).toContain("hamma save");
    expect(output).toContain("hamma switch claude");
    expect(output).toContain("hamma done");
    expect(output).toContain("hamma ask");
  });

  it("switches from a fresh project with one command", async () => {
    const switched = JSON.parse(await run([
      "switch", "claude", "--memory", "instant", "--no-launch", "--json",
    ]));
    expect(switched).toMatchObject({
      operation: "switch",
      memory: "instant",
      target: "claude",
      saved: true,
      source: { agent: "codex", sessionId: CODEX_ID },
      attach: { executionMode: "continue_work" },
    });
    await setClaudeAttachMarker(switched.attach.attachId);
    const finished = JSON.parse(await run([
      "done", "--memory", "instant", "--json",
    ]));
    expect(finished).toMatchObject({ outcome: "completed", run: { status: "completed" } });
  }, 20_000);

  it("can reopen the same attached agent by checkpointing and transferring its claim", async () => {
    const first = JSON.parse(await run([
      "switch", "claude", "--memory", "same-agent", "--no-launch", "--json",
    ]));
    await setClaudeAttachMarker(first.attach.attachId);

    const reopened = JSON.parse(await run([
      "switch", "claude", "--memory", "same-agent", "--no-launch", "--json",
    ]));
    expect(reopened).toMatchObject({
      target: "claude",
      saved: true,
      transferredClaim: true,
      attach: { executionMode: "continue_work" },
    });
    expect(reopened.attach.attachId).not.toBe(first.attach.attachId);
    await setClaudeAttachMarker(reopened.attach.attachId);
    await run(["done", "--memory", "same-agent", "--json"]);
  }, 20_000);

  it("records a blocker in plain language", async () => {
    await run(["save", "--agent", "codex", "--memory", "blocked-work", "--json"]);
    const blocked = JSON.parse(await run([
      "done", "--agent", "codex", "--memory", "blocked-work",
      "--blocked", "--next", "Ask the user for the missing API key.", "--json",
    ]));
    expect(blocked).toMatchObject({ operation: "done", outcome: "blocked" });
    const shown = JSON.parse(await run(["memory", "show", "blocked-work", "--json"]));
    expect(shown.latest.state).toMatchObject({
      outcome: "blocked",
      nextAction: "Ask the user for the missing API key.",
    });
  }, 20_000);

  it("saves, switches, finishes, and recalls without exposing lifecycle mechanics", async () => {
    const saved = JSON.parse(await run([
      "save", "--agent", "codex", "--memory", "default", "--json",
    ]));
    expect(saved).toMatchObject({
      operation: "save",
      memory: "default",
      source: { agent: "codex", sessionId: CODEX_ID },
      mode: "sync",
      updated: true,
      outcome: "actionable",
    });

    const switched = JSON.parse(await run([
      "switch", "claude", "--no-save", "--no-launch", "--json",
    ]));
    expect(switched).toMatchObject({
      operation: "switch",
      target: "claude",
      saved: false,
      attach: {
        executionMode: "continue_work",
        autoExecuteAllowed: true,
        run: { status: "claimed", targetCli: "claude" },
      },
    });
    expect(switched.attach.attachId).toMatch(/^[0-9a-f-]{36}$/);
    await setClaudeAttachMarker(switched.attach.attachId);
    await expect(run(["save", "--agent", "codex", "--json"]))
      .rejects.toThrow("belongs to claude");

    const checkpointed = JSON.parse(await run(["save", "--json"]));
    expect(checkpointed).toMatchObject({
      operation: "save",
      source: { agent: "claude", sessionId: CLAUDE_ID },
      mode: "checkpoint",
      attachId: switched.attach.attachId,
    });

    const finished = JSON.parse(await run(["done", "--json"]));
    expect(finished).toMatchObject({
      operation: "done",
      source: { agent: "claude", sessionId: CLAUDE_ID },
      outcome: "completed",
      attachId: switched.attach.attachId,
      run: { status: "completed" },
    });

    const contextOnly = JSON.parse(await run([
      "switch", "claude", "--no-save", "--no-launch", "--json",
    ]));
    expect(contextOnly.attach).toMatchObject({
      executionMode: "ready_for_input",
      autoExecuteAllowed: false,
      previousOutcome: "completed",
    });
    expect(contextOnly.attach.attachId).toBeUndefined();

    const recalled = JSON.parse(await run([
      "ask", "simple CLI", "--json",
    ]));
    expect(recalled.operation).toBeUndefined();
    expect(recalled.memory).toBe("default");
    expect(recalled.results.length).toBeGreaterThan(0);
  }, 30_000);
});

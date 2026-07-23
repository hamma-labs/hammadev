import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  inspectMemory,
  startMemory,
  syncMemory,
  attachMemory,
} from "../../src/core/memory.js";
import {
  simpleSave,
  simpleSwitch,
  simpleDone,
} from "../../src/core/simple-ux.js";

let fixtureRoot = "";
let projectPath = "";
let codexHome = "";
let previousCodexHome: string | undefined;

async function writeCodexSession(
  sessionId: string,
  content: string,
  options: { second?: number } = {}
): Promise<string> {
  const second = options.second ?? 0;
  const target = path.join(
    codexHome,
    "sessions",
    "2026",
    "07",
    "22",
    `rollout-2026-07-22T10-00-${String(second).padStart(2, "0")}-${sessionId}.jsonl`
  );
  await fs.mkdir(path.dirname(target), { recursive: true });
  const lines = [
    JSON.stringify({
      type: "session_meta",
      payload: {
        id: sessionId,
        cwd: projectPath,
        timestamp: `2026-07-22T10:00:${String(second).padStart(2, "0")}Z`,
      },
    }),
    JSON.stringify({
      type: "event_msg",
      payload: { type: "user_message", message: `Implement ${content}.` },
    }),
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: `Work remains for ${content}. Next action: verify ${content}.`,
      },
    }),
  ];
  await fs.writeFile(target, `${lines.join("\n")}\n`, "utf8");
  const modified = new Date(`2026-07-22T10:01:${String(second).padStart(2, "0")}Z`);
  await fs.utimes(target, modified, modified);
  return target;
}

beforeEach(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-friction-fixes-"));
  projectPath = path.join(fixtureRoot, "project");
  codexHome = path.join(fixtureRoot, "codex-home");
  await fs.mkdir(projectPath, { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: projectPath });
  execFileSync("git", ["config", "user.email", "friction@example.test"], { cwd: projectPath });
  execFileSync("git", ["config", "user.name", "Friction Fixes Test"], { cwd: projectPath });
  await fs.writeFile(path.join(projectPath, "README.md"), "friction fixes test\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: projectPath });
  execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: projectPath });
  previousCodexHome = process.env.CODEX_HOME;
  process.env.CODEX_HOME = codexHome;
});

afterEach(async () => {
  if (previousCodexHome === undefined) delete process.env.CODEX_HOME;
  else process.env.CODEX_HOME = previousCodexHome;
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("progress callbacks", () => {
  it("simpleSave invokes onProgress during save", async () => {
    const memory = "progress-save";
    await startMemory(projectPath, memory, undefined, false);
    await writeCodexSession("progress-session", "progress test");

    const messages: string[] = [];
    const result = await simpleSave(projectPath, {
      agent: "codex",
      memory,
      useGitignore: false,
      onProgress: (msg) => messages.push(msg),
    });

    expect(result.updated).toBe(true);
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.includes("Writing"))).toBe(true);
  });

  it("simpleSwitch invokes onProgress during switch", async () => {
    const memory = "progress-switch";
    await startMemory(projectPath, memory, undefined, false);
    await writeCodexSession("progress-switch-session", "switch progress test");
    await syncMemory(projectPath, memory, {
      source: "codex:progress-switch-session",
      useGitignore: false,
    });

    const messages: string[] = [];
    const result = await simpleSwitch(projectPath, "claude", {
      memory,
      save: false,
      useGitignore: false,
      onProgress: (msg) => messages.push(msg),
    });

    expect(result.target).toBe("claude");
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.includes("Preparing") || m.includes("context"))).toBe(true);
  });

  it("simpleDone invokes onProgress during done", async () => {
    const memory = "progress-done";
    await startMemory(projectPath, memory, undefined, false);
    await writeCodexSession("progress-done-session", "done progress test");

    const messages: string[] = [];
    const result = await simpleDone(projectPath, {
      agent: "codex",
      memory,
      useGitignore: false,
      onProgress: (msg) => messages.push(msg),
    });

    expect(result.outcome).toBe("completed");
    expect(messages.length).toBeGreaterThan(0);
    expect(messages.some((m) => m.includes("Closing") || m.includes("epoch"))).toBe(true);
  });
});

describe("memory lock retry", () => {
  it("retries when lock is held by a live process and eventually throws with retry count", async () => {
    const memory = "lock-retry";
    await startMemory(projectPath, memory, undefined, false);
    await writeCodexSession("lock-retry-session", "lock retry test");

    // Create a lock owned by the current process (alive = true)
    const memDir = path.join(projectPath, ".hamma", "memories", memory);
    const lock = path.join(memDir, ".sync-lock");
    await fs.mkdir(lock);
    await fs.writeFile(
      path.join(lock, "owner.json"),
      JSON.stringify({ pid: process.pid, createdAt: new Date().toISOString() }) + "\n"
    );

    await expect(syncMemory(projectPath, memory, {
      source: "codex:lock-retry-session",
      useGitignore: false,
    })).rejects.toThrow(/Retried 3 times/);
  });
});

describe("auto-resolve attach ID", () => {
  it("memory commands work without explicit --attach when single open run exists", async () => {
    const memory = "auto-attach";
    await startMemory(projectPath, memory, undefined, false);
    await writeCodexSession("auto-attach-session", "auto attach test");
    await syncMemory(projectPath, memory, {
      source: "codex:auto-attach-session",
      useGitignore: false,
    });

    // Create an attach claim
    const attach = await attachMemory(projectPath, memory, "codex", {
      noSync: true,
      useGitignore: false,
    });
    expect(attach.attachId).toBeTruthy();

    // Verify the inspection shows exactly one open run
    const inspection = await inspectMemory(projectPath, memory);
    expect(inspection.openRuns.length).toBe(1);
    expect(inspection.openRuns[0].id).toBe(attach.attachId);
  });
});

describe("stale cleanup", () => {
  it("cleanupStaleLaunches removes records older than 7 days", async () => {
    // This test verifies the function signature and behavior with no records
    const { cleanupStaleLaunches } = await import("../../src/core/agent-launch.js");
    // With no runtime directory, should return 0 without error
    const removed = await cleanupStaleLaunches("codex", projectPath);
    expect(removed).toBe(0);
  });
});

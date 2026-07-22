import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  inspectMemory,
  startMemory,
  syncMemory,
} from "../../src/core/memory.js";

let fixtureRoot = "";
let projectPath = "";
let codexHome = "";
let previousCodexHome: string | undefined;

async function writeCodexSession(
  sessionId: string,
  content: string,
  options: { truncated?: boolean; second?: number } = {}
): Promise<string> {
  const second = options.second ?? 0;
  const target = path.join(
    codexHome,
    "sessions",
    "2026",
    "07",
    "21",
    `rollout-2026-07-21T16-00-${String(second).padStart(2, "0")}-${sessionId}.jsonl`
  );
  await fs.mkdir(path.dirname(target), { recursive: true });
  const lines = [
    JSON.stringify({
      type: "session_meta",
      payload: {
        id: sessionId,
        cwd: projectPath,
        timestamp: `2026-07-21T16:00:${String(second).padStart(2, "0")}Z`,
      },
    }),
    JSON.stringify({
      type: "event_msg",
      payload: { type: "user_message", message: `Implement ${content}.` },
    }),
    ...(options.truncated ? ["{\"type\":\"event_msg\",\"payload\":"] : []),
    JSON.stringify({
      type: "event_msg",
      payload: {
        type: "agent_message",
        message: `Work remains for ${content}. Next action: verify ${content}.`,
      },
    }),
  ];
  await fs.writeFile(target, `${lines.join("\n")}\n`, "utf8");
  const modified = new Date(`2026-07-21T16:01:${String(second).padStart(2, "0")}Z`);
  await fs.utimes(target, modified, modified);
  return target;
}

function memoryDirectory(name: string): string {
  return path.join(projectPath, ".hamma", "memories", name);
}

beforeEach(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-memory-faults-"));
  projectPath = path.join(fixtureRoot, "project");
  codexHome = path.join(fixtureRoot, "codex-home");
  await fs.mkdir(projectPath, { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: projectPath });
  execFileSync("git", ["config", "user.email", "faults@example.test"], { cwd: projectPath });
  execFileSync("git", ["config", "user.name", "Fault Injection Test"], { cwd: projectPath });
  await fs.writeFile(path.join(projectPath, "README.md"), "fault injection\n", "utf8");
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

describe("memory fault recovery", () => {
  it.each(["after-revision-files-written", "after-revision-published"] as const)(
    "rolls back a simulated power loss at %s and permits an exact retry",
    async (stage) => {
      const memory = `power-${stage === "after-revision-published" ? "published" : "written"}`;
      const sessionId = `${memory}-session`;
      await startMemory(projectPath, memory, undefined, false);
      await writeCodexSession(sessionId, "durable revision publication");

      await expect(syncMemory(projectPath, memory, {
        source: `codex:${sessionId}`,
        useGitignore: false,
        faultInjector: (current) => {
          if (current === stage) throw new Error(`simulated power loss at ${stage}`);
        },
      })).rejects.toThrow(`simulated power loss at ${stage}`);

      const failedInspection = await inspectMemory(projectPath, memory);
      expect(failedInspection.manifest.revisionCount).toBe(0);
      expect(failedInspection.latest).toBeUndefined();
      expect(await fs.readdir(path.join(memoryDirectory(memory), "revisions"))).toEqual([]);
      await expect(fs.access(path.join(memoryDirectory(memory), ".sync-lock"))).rejects.toThrow();

      const retried = await syncMemory(projectPath, memory, {
        source: `codex:${sessionId}`,
        useGitignore: false,
      });
      expect(retried).toMatchObject({ updated: true, revision: { parentRevision: undefined } });
      expect((await inspectMemory(projectPath, memory)).manifest.revisionCount).toBe(1);
    }
  );

  it("recovers a stale dead-owner lock before synchronizing", async () => {
    const memory = "stale-lock";
    const sessionId = "stale-lock-session";
    await startMemory(projectPath, memory, undefined, false);
    await writeCodexSession(sessionId, "stale lock recovery");
    const lock = path.join(memoryDirectory(memory), ".sync-lock");
    await fs.mkdir(lock);
    await fs.writeFile(
      path.join(lock, "owner.json"),
      `${JSON.stringify({ pid: 2_147_483_647, createdAt: "2020-01-01T00:00:00.000Z" })}\n`
    );
    const stale = new Date("2020-01-01T00:00:00.000Z");
    await fs.utimes(lock, stale, stale);

    const result = await syncMemory(projectPath, memory, {
      source: `codex:${sessionId}`,
      useGitignore: false,
    });
    expect(result.updated).toBe(true);
    await expect(fs.access(lock)).rejects.toThrow();
  });

  it("removes orphaned publish and manifest temp artifacts from a hard crash", async () => {
    const memory = "orphaned-publish";
    const sessionId = "orphaned-publish-session";
    await startMemory(projectPath, memory, undefined, false);
    await writeCodexSession(sessionId, "orphaned publish recovery");
    const directory = memoryDirectory(memory);
    const orphan = path.join(
      directory,
      "revisions",
      "000001-2026-07-21T16-00-00-000Z-codex"
    );
    await fs.mkdir(orphan);
    await fs.writeFile(path.join(orphan, "revision.json"), "{}\n");
    await fs.writeFile(path.join(directory, "memory.json.tmp-999-1"), "partial manifest");
    await fs.writeFile(path.join(directory, "notes.tmp-user"), "preserve me\n");

    const result = await syncMemory(projectPath, memory, {
      source: `codex:${sessionId}`,
      useGitignore: false,
    });
    expect(result.updated).toBe(true);
    await expect(fs.access(orphan)).rejects.toThrow();
    await expect(fs.access(path.join(directory, "memory.json.tmp-999-1"))).rejects.toThrow();
    await expect(fs.readFile(path.join(directory, "notes.tmp-user"), "utf8"))
      .resolves.toBe("preserve me\n");
    expect((await inspectMemory(projectPath, memory)).manifest.revisionCount).toBe(1);
  });

  it("rejects a simultaneous writer while preserving the first writer", async () => {
    const memory = "concurrent";
    await startMemory(projectPath, memory, undefined, false);
    await writeCodexSession("concurrent-first", "the first concurrent update", { second: 1 });
    await writeCodexSession("concurrent-second", "the second concurrent update", { second: 2 });

    let releaseFirst!: () => void;
    const release = new Promise<void>((resolve) => { releaseFirst = resolve; });
    let firstLocked!: () => void;
    const locked = new Promise<void>((resolve) => { firstLocked = resolve; });
    const first = syncMemory(projectPath, memory, {
      source: "codex:concurrent-first",
      useGitignore: false,
      faultInjector: async (stage) => {
        if (stage !== "after-lock-acquired") return;
        firstLocked();
        await release;
      },
    });
    await locked;

    await expect(syncMemory(projectPath, memory, {
      source: "codex:concurrent-second",
      useGitignore: false,
    })).rejects.toThrow("already being synchronized");
    releaseFirst();
    expect((await first).updated).toBe(true);
    const inspection = await inspectMemory(projectPath, memory);
    expect(inspection.manifest.revisionCount).toBe(1);
    expect(inspection.latest?.revision.sourceSessionId).toBe("concurrent-first");
  });

  it("salvages a valid session with a truncated JSONL record", async () => {
    const memory = "truncated";
    const sessionId = "truncated-session";
    await startMemory(projectPath, memory, undefined, false);
    await writeCodexSession(sessionId, "truncated transcript recovery", {
      truncated: true,
    });

    const result = await syncMemory(projectPath, memory, {
      source: `codex:${sessionId}`,
      useGitignore: false,
    });
    expect(result.updated).toBe(true);
    const inspection = await inspectMemory(projectPath, memory);
    expect(inspection.latest?.state.nextAction).toContain("truncated transcript recovery");
  });
});

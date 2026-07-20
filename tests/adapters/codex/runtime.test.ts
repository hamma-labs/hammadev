import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  discardCodexLaunch,
  listCodexLaunches,
  prepareCodexLaunch,
  recoverCodexLaunches,
  registerCodexSessionStart,
  setCodexLaunchChildPid,
} from "../../../src/adapters/codex/runtime.js";
import {
  attachMemory,
  inspectMemory,
  startMemory,
  syncMemory,
} from "../../../src/core/memory.js";

const DEAD_WRAPPER_PID = 2_147_483_647;
const DEAD_CHILD_PID = 2_147_483_646;

let fixtureRoot = "";
let projectPath = "";
let codexHome = "";
let previousCodexHome: string | undefined;

async function writeCodexSession(sessionId: string, suffix = ""): Promise<string> {
  const target = path.join(
    codexHome,
    "sessions",
    "2026",
    "07",
    "20",
    `rollout-2026-07-20T12-00-0${suffix || "0"}-${sessionId}.jsonl`
  );
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, [
    {
      type: "session_meta",
      payload: {
        id: sessionId,
        cwd: projectPath,
        timestamp: `2026-07-20T12:00:0${suffix || "0"}Z`,
      },
    },
    {
      type: "event_msg",
      timestamp: `2026-07-20T12:00:1${suffix || "0"}Z`,
      payload: {
        type: "user_message",
        message: `Implement reliable Codex recovery ${suffix}.`,
      },
    },
    {
      type: "event_msg",
      timestamp: `2026-07-20T12:00:2${suffix || "0"}Z`,
      payload: {
        type: "agent_message",
        message: `The recovery work remains. Next verify exact session ${sessionId}.`,
      },
    },
  ].map((record) => JSON.stringify(record)).join("\n") + "\n");
  const modified = new Date(`2026-07-20T12:00:3${suffix || "0"}Z`);
  await fs.utimes(target, modified, modified);
  return target;
}

beforeEach(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-codex-runtime-"));
  projectPath = path.join(fixtureRoot, "project");
  codexHome = path.join(fixtureRoot, "codex-home");
  await fs.mkdir(projectPath, { recursive: true });
  execFileSync("git", ["init", "--quiet"], { cwd: projectPath });
  execFileSync("git", ["config", "user.email", "runtime@example.test"], { cwd: projectPath });
  execFileSync("git", ["config", "user.name", "Runtime Test"], { cwd: projectPath });
  await fs.writeFile(path.join(projectPath, "README.md"), "runtime test\n");
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

describe("Codex runtime recovery", () => {
  it("stays disabled until project memory has been explicitly enabled", async () => {
    const prepared = await prepareCodexLaunch(projectPath);
    expect(prepared).toMatchObject({
      enabled: false,
      reason: expect.stringContaining("No active project memory"),
    });
    await expect(fs.access(path.join(projectPath, ".hamma"))).rejects.toThrow();
  });

  it("recovers an exact session after both wrapper and child are gone", async () => {
    const sessionId = "runtime-crash-session";
    await startMemory(projectPath, "default", undefined, false);
    await writeCodexSession(sessionId);
    const prepared = await prepareCodexLaunch(projectPath, {
      wrapperPid: DEAD_WRAPPER_PID,
    });
    expect(prepared.launch).toBeTruthy();
    await setCodexLaunchChildPid(projectPath, prepared.launch!.id, DEAD_CHILD_PID);
    await registerCodexSessionStart(
      projectPath,
      { session_id: sessionId, hook_event_name: "SessionStart" },
      prepared.launch!.id
    );

    const recovered = await recoverCodexLaunches(projectPath);
    expect(recovered).toEqual([expect.objectContaining({
      status: "updated",
      sessionId,
      memory: "default",
    })]);
    expect(await listCodexLaunches(projectPath)).toEqual([]);
    const inspection = await inspectMemory(projectPath, "default");
    expect(inspection.latest?.revision.sourceSessionId).toBe(sessionId);
  });

  it("does not recover a launch while its wrapper is still alive", async () => {
    const sessionId = "runtime-live-session";
    await startMemory(projectPath, "default", undefined, false);
    await writeCodexSession(sessionId);
    const prepared = await prepareCodexLaunch(projectPath, { wrapperPid: process.pid });
    await registerCodexSessionStart(
      projectPath,
      { session_id: sessionId },
      prepared.launch!.id
    );

    const recovered = await recoverCodexLaunches(projectPath);
    expect(recovered).toEqual([expect.objectContaining({ status: "active", sessionId })]);
    expect(await listCodexLaunches(projectPath)).toHaveLength(1);
    await discardCodexLaunch(projectPath, prepared.launch!.id);
  });

  it.skipIf(process.platform !== "linux")(
    "does recover when a live PID has a different process-start identity",
    async () => {
      const sessionId = "runtime-reused-pid-session";
      await startMemory(projectPath, "default", undefined, false);
      await writeCodexSession(sessionId);
      const prepared = await prepareCodexLaunch(projectPath, { wrapperPid: process.pid });
      await registerCodexSessionStart(
        projectPath,
        { session_id: sessionId },
        prepared.launch!.id
      );
      const target = path.join(
        projectPath,
        ".hamma",
        "runtime",
        "codex",
        `${prepared.launch!.id}.json`
      );
      const record = JSON.parse(await fs.readFile(target, "utf8"));
      record.wrapperIdentity = "linux:different-boot:different-start";
      await fs.writeFile(target, `${JSON.stringify(record, null, 2)}\n`);

      const recovered = await recoverCodexLaunches(projectPath);
      expect(recovered[0]).toMatchObject({ status: "updated", sessionId });
      expect(await listCodexLaunches(projectPath)).toEqual([]);
    }
  );

  it("retains a failed exact-session checkpoint for a later retry", async () => {
    await startMemory(projectPath, "default", undefined, false);
    const prepared = await prepareCodexLaunch(projectPath, {
      wrapperPid: DEAD_WRAPPER_PID,
    });
    await registerCodexSessionStart(
      projectPath,
      { session_id: "missing-runtime-session" },
      prepared.launch!.id
    );

    const recovered = await recoverCodexLaunches(projectPath);
    expect(recovered[0]).toMatchObject({
      status: "pending",
      sessionId: "missing-runtime-session",
    });
    const records = await listCodexLaunches(projectPath);
    expect(records[0]).toMatchObject({
      state: "failed",
      checkpointAttempts: 1,
      lastError: expect.stringContaining("No Codex session found"),
    });
    await discardCodexLaunch(projectPath, prepared.launch!.id);
  });

  it("checkpoints through an open Codex attach claim instead of bypassing it", async () => {
    const initialId = "runtime-attached-initial";
    const recoveredId = "runtime-attached-recovered";
    await startMemory(projectPath, "default", undefined, false);
    await writeCodexSession(initialId, "1");
    await syncMemory(projectPath, "default", {
      source: `codex:${initialId}`,
      useGitignore: false,
    });
    const attached = await attachMemory(projectPath, "default", "codex", {
      noSync: true,
      useGitignore: false,
    });
    expect(attached.attachId).toBeTruthy();

    await writeCodexSession(recoveredId, "2");
    const prepared = await prepareCodexLaunch(projectPath, {
      wrapperPid: DEAD_WRAPPER_PID,
    });
    await registerCodexSessionStart(
      projectPath,
      { session_id: recoveredId },
      prepared.launch!.id
    );
    const recovered = await recoverCodexLaunches(projectPath);
    expect(recovered[0]).toMatchObject({ status: "updated", sessionId: recoveredId });
    const inspection = await inspectMemory(projectPath, "default");
    expect(inspection.openRuns[0]).toMatchObject({
      id: attached.attachId,
      status: "running",
      targetSessionId: recoveredId,
    });
  });

  it("refuses to rebind one wrapper launch to a different session", async () => {
    await startMemory(projectPath, "default", undefined, false);
    const prepared = await prepareCodexLaunch(projectPath, { wrapperPid: process.pid });
    await registerCodexSessionStart(
      projectPath,
      { session_id: "runtime-first-session" },
      prepared.launch!.id
    );
    await expect(registerCodexSessionStart(
      projectPath,
      { session_id: "runtime-second-session" },
      prepared.launch!.id
    )).rejects.toThrow(/already bound/);
    await discardCodexLaunch(projectPath, prepared.launch!.id);
  });
});

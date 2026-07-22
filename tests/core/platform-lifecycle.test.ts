import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  discardAgentLaunch,
  forwardedSignalsForPlatform,
  launchAgentWithRecovery,
  listAgentLaunches,
  prepareAgentLaunch,
  registerAgentSessionStart,
  signalExitCode,
} from "../../src/core/agent-launch.js";
import { installHooks } from "../../src/core/hooks-install.js";
import { startMemory } from "../../src/core/memory.js";
import {
  getBootstrapMode,
  setBootstrapMode,
} from "../../src/core/project-config.js";

const agents = ["claude", "codex", "grok"] as const;
const deadPid = 2_147_483_647;

let fixtureRoot = "";
let projectPath = "";
let noMemoryProject = "";

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-platform-lifecycle-"));
  projectPath = path.join(fixtureRoot, "project with spaces");
  noMemoryProject = path.join(fixtureRoot, "project without memory");
  await Promise.all([
    fs.mkdir(projectPath, { recursive: true }),
    fs.mkdir(noMemoryProject, { recursive: true }),
  ]);
  execFileSync("git", ["init", "--quiet"], { cwd: projectPath });
  execFileSync("git", ["config", "user.email", "platform@example.test"], { cwd: projectPath });
  execFileSync("git", ["config", "user.name", "Platform Test"], { cwd: projectPath });
  await fs.writeFile(path.join(projectPath, "README.md"), "platform lifecycle\n", "utf8");
  execFileSync("git", ["add", "README.md"], { cwd: projectPath });
  execFileSync("git", ["commit", "--quiet", "-m", "initial"], { cwd: projectPath });
  await startMemory(projectPath, "default", undefined, false);
});

afterAll(async () => {
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("portable lifecycle contract", () => {
  it.each(agents)("launches a portable %s child and preserves its exit code", async (agent) => {
    const result = await launchAgentWithRecovery(agent, {
      projectPath: noMemoryProject,
      command: process.execPath,
      args: ["-e", "process.exit(17)"],
    });

    expect(result).toMatchObject({
      exitCode: 17,
      recoveryEnabled: false,
    });
    expect(result.setupWarning).toContain("No active project memory");
  });

  it("uses an explicit cross-platform signal contract", () => {
    expect(forwardedSignalsForPlatform("win32")).toEqual(["SIGINT", "SIGTERM"]);
    expect(forwardedSignalsForPlatform("darwin")).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
    expect(forwardedSignalsForPlatform("linux")).toEqual(["SIGINT", "SIGTERM", "SIGHUP"]);
    expect(signalExitCode("SIGTERM")).toBeGreaterThan(128);
  });

  it("writes and reads project configuration in a path containing spaces", async () => {
    expect(await getBootstrapMode(projectPath)).toBe("manual");
    await setBootstrapMode(projectPath, "automatic");
    expect(await getBootstrapMode(projectPath)).toBe("automatic");
  });

  it.each(agents)("installs %s lifecycle hooks with portable paths", async (agent) => {
    const result = await installHooks({ agent, projectPath });
    expect(result.warnings).toEqual([]);
    expect(result.installed).toContain("SessionStart");
    const content = JSON.parse(await fs.readFile(result.settingsPath, "utf8"));
    expect(JSON.stringify(content)).toContain(`--hook-agent ${agent}`);
  });

  it.each(agents)("persists, binds, lists, and discards a %s launch record", async (agent) => {
    const prepared = await prepareAgentLaunch(agent, projectPath, {
      wrapperPid: deadPid,
    });
    expect(prepared.enabled).toBe(true);
    expect(prepared.launch?.projectPath).toBe(projectPath);

    const sessionId = `${agent}-platform-session`;
    const registered = await registerAgentSessionStart(
      agent,
      projectPath,
      { session_id: sessionId },
      prepared.launch!.id
    );
    expect(registered).toMatchObject({ status: "registered", sessionId });
    expect(await listAgentLaunches(agent, projectPath)).toEqual([
      expect.objectContaining({ memory: "default", sessionId }),
    ]);

    await discardAgentLaunch(agent, projectPath, prepared.launch!.id);
    expect(await listAgentLaunches(agent, projectPath)).toEqual([]);
  });
});

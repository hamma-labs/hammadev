import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatProjectStatus,
  getProjectStatus,
} from "../../src/core/project-status.js";

const execFileAsync = promisify(execFile);
const OLDER_ID = "2026-07-01T10-00-00-000Z-codex-to-claude";
const LATEST_ID = "2026-07-02T11-00-00-000Z-claude-to-codex";

let root = "";
let projectPath = "";
let codexHome = "";
let claudeHome = "";

async function git(args: string[]): Promise<void> {
  await execFileAsync("git", ["-C", projectPath, ...args]);
}

async function writeSessions(): Promise<void> {
  for (const [date, timestamp, id] of [
    ["2026/07/01", "2026-07-01T10-00-00", "codex-one"],
    ["2026/07/02", "2026-07-02T10-00-00", "codex-two"],
  ]) {
    const directory = path.join(codexHome, "sessions", date);
    await fs.mkdir(directory, { recursive: true });
    await fs.writeFile(
      path.join(directory, `rollout-${timestamp}-${id}.jsonl`),
      "",
      "utf8"
    );
  }

  const claudeSession = path.join(
    claudeHome,
    "projects",
    "fixture",
    "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa.jsonl"
  );
  await fs.mkdir(path.dirname(claudeSession), { recursive: true });
  await fs.writeFile(
    claudeSession,
    `${JSON.stringify({
      type: "user",
      sessionId: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
      cwd: projectPath,
    })}\n`,
    "utf8"
  );
}

async function writeHandoffs(): Promise<void> {
  const tasksPath = path.join(projectPath, ".hamma", "tasks");
  const olderPath = path.join(tasksPath, OLDER_ID);
  const latestPath = path.join(tasksPath, LATEST_ID);
  await fs.mkdir(olderPath, { recursive: true });
  await fs.mkdir(latestPath, { recursive: true });
  await fs.mkdir(path.join(tasksPath, ".tmp-stale"), { recursive: true });

  await fs.writeFile(
    path.join(olderPath, "handoff.md"),
    "# Hamma Handoff\n\n## Source\n- Source CLI: codex\n- Target CLI: claude\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(latestPath, "handoff.md"),
    "# Hamma Handoff\n\n## Continue from here\nKeep going.\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(latestPath, "state.json"),
    JSON.stringify({ project: { sourceCli: "claude", targetCli: "codex" } }),
    "utf8"
  );
  await fs.writeFile(
    path.join(latestPath, "session.json"),
    "RAW_TRANSCRIPT_MUST_NOT_APPEAR",
    "utf8"
  );
}

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-project-status-"));
  projectPath = path.join(root, "project");
  codexHome = path.join(root, "codex-home");
  claudeHome = path.join(root, "claude-home");
  await fs.mkdir(projectPath);
  await Promise.all([writeSessions(), writeHandoffs()]);

  await git(["init", "-q"]);
  await fs.writeFile(path.join(projectPath, "README.md"), "fixture\n", "utf8");
  await fs.writeFile(path.join(projectPath, ".gitignore"), ".hamma/\n", "utf8");
  await git(["add", "README.md", ".gitignore"]);
  await git([
    "-c",
    "user.name=Hamma Tests",
    "-c",
    "user.email=hamma@example.test",
    "commit",
    "-qm",
    "fixture",
  ]);
});

afterEach(async () => {
  if (root) await fs.rm(root, { recursive: true, force: true });
});

describe("project status", () => {
  it("summarizes a clean git project without reading session.json", async () => {
    const status = await getProjectStatus(projectPath, {
      codexHome,
      claudeHomes: [claudeHome],
    });

    expect(status).toEqual({
      projectPath,
      isGitRepo: true,
      gitStatus: "clean",
      handoffCount: 2,
      latestHandoff: {
        taskId: LATEST_ID,
        path: path.join(projectPath, ".hamma", "tasks", LATEST_ID, "handoff.md"),
        sourceAgent: "claude",
        targetAgent: "codex",
      },
      codexSessionCount: 2,
      claudeSessionCount: 1,
      codexProjectSessionCount: 0,
      claudeProjectSessionCount: 1,
      hammaIgnored: true,
    });

    const output = formatProjectStatus(status);
    expect(output).toContain(`Project: ${projectPath}`);
    expect(output).toContain("Latest source → target: claude → codex");
    expect(output).not.toContain("session.json");
    expect(output).not.toContain("RAW_TRANSCRIPT_MUST_NOT_APPEAR");
  });

  it("reports dirty git state", async () => {
    await fs.writeFile(path.join(projectPath, "dirty.txt"), "dirty\n", "utf8");
    await fs.writeFile(
      path.join(projectPath, ".gitignore"),
      "# not ignored\n",
      "utf8"
    );

    const status = await getProjectStatus(projectPath, {
      codexHome,
      claudeHomes: [claudeHome],
    });

    expect(status.gitStatus).toBe("dirty");
    expect(status.hammaIgnored).toBe(false);
  });

  it("handles a project without git or handoffs", async () => {
    const plainProject = path.join(root, "plain-project");
    await fs.mkdir(plainProject);

    const status = await getProjectStatus(plainProject, {
      codexHome,
      claudeHomes: [claudeHome],
    });

    expect(status.isGitRepo).toBe(false);
    expect(status.gitStatus).toBe("not-a-repository");
    expect(status.handoffCount).toBe(0);
    expect(status.latestHandoff).toBeUndefined();
    expect(status.hammaIgnored).toBeNull();
    expect(formatProjectStatus(status)).toContain(
      ".hamma/ ignored: n/a (not a git repository)"
    );
  });
});

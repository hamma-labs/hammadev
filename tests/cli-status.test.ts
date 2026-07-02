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
const TASK_ID = "2026-07-02T11-00-00-000Z-codex-to-claude";

let fixtureRoot = "";
let projectPath = "";
let otherPath = "";
let fakeHome = "";

async function run(args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync(TSX, [CLI, ...args], {
    cwd,
    env: { ...process.env, HOME: fakeHome },
  });
  return result.stdout;
}

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-cli-status-"));
  projectPath = path.join(fixtureRoot, "project");
  otherPath = path.join(fixtureRoot, "other");
  fakeHome = path.join(fixtureRoot, "home");
  await Promise.all([
    fs.mkdir(projectPath),
    fs.mkdir(otherPath),
    fs.mkdir(fakeHome),
  ]);

  const taskPath = path.join(projectPath, ".hamma", "tasks", TASK_ID);
  await fs.mkdir(taskPath, { recursive: true });
  await fs.writeFile(
    path.join(taskPath, "handoff.md"),
    "# Hamma Handoff\n\n## Source\n- Source CLI: codex\n- Target CLI: claude\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(taskPath, "session.json"),
    "RAW_TRANSCRIPT_MUST_NOT_APPEAR",
    "utf8"
  );

  const codexSession = path.join(
    fakeHome,
    ".codex",
    "sessions",
    "2026",
    "07",
    "02",
    "rollout-2026-07-02T10-00-00-codex-status.jsonl"
  );
  await fs.mkdir(path.dirname(codexSession), { recursive: true });
  await fs.writeFile(codexSession, "", "utf8");

  const claudeSession = path.join(
    fakeHome,
    ".claude",
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
});

afterAll(async () => {
  if (fixtureRoot) {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

describe("status CLI command", () => {
  it("uses the current working directory by default", async () => {
    const output = await run(["status"], projectPath);

    expect(output).toContain(`Project: ${projectPath}`);
    expect(output).toContain("Git repository: no");
    expect(output).toContain(".hamma/tasks count: 1");
    expect(output).toContain(`Latest handoff id: ${TASK_ID}`);
    expect(output).toContain("Latest source → target: codex → claude");
    expect(output).toContain("Codex sessions: 1");
    expect(output).toContain("Claude sessions: 1");
    expect(output).not.toContain("session.json");
    expect(output).not.toContain("RAW_TRANSCRIPT_MUST_NOT_APPEAR");
  });

  it("supports --project from another working directory", async () => {
    const output = await run(["status", "--project", projectPath], otherPath);

    expect(output).toContain(`Project: ${projectPath}`);
    expect(output).toContain(`Latest handoff path: ${path.join(
      projectPath,
      ".hamma",
      "tasks",
      TASK_ID,
      "handoff.md"
    )}`);
  });
});

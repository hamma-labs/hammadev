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
const OLDER_ID = "2026-05-01T08-00-00-000Z-codex-to-claude";
const LATEST_ID = "2026-05-03T09-15-00-000Z-claude-to-codex";

let projectPath = "";
let otherPath = "";

async function run(args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync(TSX, [CLI, ...args], { cwd });
  return result.stdout;
}

beforeAll(async () => {
  projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-cli-history-"));
  otherPath = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-cli-cwd-"));
  const tasksPath = path.join(projectPath, ".hamma", "tasks");

  for (const [taskId, source, target, next] of [
    [OLDER_ID, "codex", "claude", "Continue the old handoff."],
    [LATEST_ID, "claude", "codex", "Continue the latest handoff."],
  ]) {
    const taskPath = path.join(tasksPath, taskId);
    await fs.mkdir(taskPath, { recursive: true });
    await fs.writeFile(
      path.join(taskPath, "handoff.md"),
      `# Hamma Handoff\n\n## Continue from here\n${next}\n\n## Source\n- Source CLI: ${source}\n- Target CLI: ${target}\n`,
      "utf8"
    );
  }

  await fs.writeFile(
    path.join(tasksPath, LATEST_ID, "session.json"),
    "RAW_TRANSCRIPT_MUST_NOT_APPEAR",
    "utf8"
  );
});

afterAll(async () => {
  await Promise.all(
    [projectPath, otherPath].map((directory) =>
      fs.rm(directory, { recursive: true, force: true })
    )
  );
});

describe("history CLI commands", () => {
  it("log uses the current working directory and lists newest first", async () => {
    const output = await run(["log"], projectPath);

    expect(output.indexOf(LATEST_ID)).toBeLessThan(output.indexOf(OLDER_ID));
    expect(output).toContain("Source agent: claude");
    expect(output).not.toContain("RAW_TRANSCRIPT_MUST_NOT_APPEAR");
  });

  it("log --project reads another project's history", async () => {
    const output = await run(["log", "--project", projectPath], otherPath);
    expect(output).toContain(LATEST_ID);
    expect(output).toContain(path.join(projectPath, ".hamma", "tasks"));
  });

  it("show latest prints only the newest handoff.md", async () => {
    const output = await run(["show", "latest"], projectPath);
    expect(output).toContain("Continue the latest handoff.");
    expect(output).not.toContain("Continue the old handoff.");
    expect(output).not.toContain("RAW_TRANSCRIPT_MUST_NOT_APPEAR");
  });

  it("show prints the requested task's handoff.md", async () => {
    const output = await run(["show", OLDER_ID], projectPath);
    expect(output).toContain("Continue the old handoff.");
    expect(output).not.toContain("Continue the latest handoff.");
  });
});

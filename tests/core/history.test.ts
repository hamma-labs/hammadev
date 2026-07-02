import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  formatHandoffLog,
  listHandoffs,
  readHandoff,
} from "../../src/core/history.js";

const OLDER_ID = "2026-06-01T10-00-00-000Z-codex-to-claude";
const LATEST_ID = "2026-06-02T11-30-00-250Z-claude-to-codex";

function handoff(source: string, target: string, next?: string): string {
  return [
    "# Hamma Handoff",
    next ? `## Continue from here\n${next}` : "",
    "## Source",
    `- Source CLI: ${source}`,
    `- Target CLI: ${target}`,
    "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

let projectPath = "";

beforeEach(async () => {
  projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-history-"));
  const tasksPath = path.join(projectPath, ".hamma", "tasks");
  await fs.mkdir(path.join(tasksPath, OLDER_ID), { recursive: true });
  await fs.mkdir(path.join(tasksPath, LATEST_ID), { recursive: true });
  await fs.mkdir(path.join(tasksPath, "incomplete-task"), { recursive: true });

  await fs.writeFile(
    path.join(tasksPath, OLDER_ID, "handoff.md"),
    handoff("codex", "claude", "Finish the older task."),
    "utf8"
  );
  await fs.writeFile(
    path.join(tasksPath, LATEST_ID, "handoff.md"),
    handoff("claude", "codex", "Run the final verification."),
    "utf8"
  );
  await fs.writeFile(
    path.join(tasksPath, LATEST_ID, "session.json"),
    JSON.stringify({ transcript: "RAW_TRANSCRIPT_MUST_NOT_APPEAR" }),
    "utf8"
  );
  await fs.writeFile(
    path.join(tasksPath, LATEST_ID, "state.json"),
    JSON.stringify({ project: { sourceCli: "claude", targetCli: "codex" } }),
    "utf8"
  );
});

afterEach(async () => {
  if (projectPath) await fs.rm(projectPath, { recursive: true, force: true });
});

describe("local handoff history", () => {
  it("lists complete handoffs newest first with metadata from handoff.md", async () => {
    const entries = await listHandoffs(projectPath);

    expect(entries.map((entry) => entry.taskId)).toEqual([LATEST_ID, OLDER_ID]);
    expect(entries[0]).toMatchObject({
      sourceAgent: "claude",
      targetAgent: "codex",
      createdAt: "2026-06-02T11:30:00.250Z",
      continueFromHere: "Run the final verification.",
    });
    expect(entries[0].handoffPath).toBe(
      path.join(projectPath, ".hamma", "tasks", LATEST_ID, "handoff.md")
    );
  });

  it("returns an empty history when the project has no .hamma/tasks directory", async () => {
    const emptyProject = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-empty-"));
    try {
      await expect(listHandoffs(emptyProject)).resolves.toEqual([]);
    } finally {
      await fs.rm(emptyProject, { recursive: true, force: true });
    }
  });

  it("reads latest and explicit task ids from handoff.md only", async () => {
    await expect(readHandoff(projectPath, "latest")).resolves.toContain(
      "Run the final verification."
    );
    await expect(readHandoff(projectPath, OLDER_ID)).resolves.toContain(
      "Finish the older task."
    );
  });

  it("rejects task ids that could escape the tasks directory", async () => {
    await expect(readHandoff(projectPath, "../session.json")).rejects.toThrow(
      "Invalid handoff task id"
    );
  });

  it("formats the requested fields without exposing session data", async () => {
    const output = formatHandoffLog(await listHandoffs(projectPath));

    expect(output).toContain(`Task: ${LATEST_ID}`);
    expect(output).toContain("Source agent: claude");
    expect(output).toContain("Target agent: codex");
    expect(output).toContain("Continue from here: Run the final verification.");
    expect(output).not.toContain("session.json");
    expect(output).not.toContain("RAW_TRANSCRIPT_MUST_NOT_APPEAR");
  });
});

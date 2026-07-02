import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { parseClaudeSession } from "../../src/adapters/claude/parse.js";
import { createHandoff } from "../../src/core/handoff.js";

const HERE = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE = path.join(
  HERE,
  "..",
  "adapters",
  "claude",
  "fixtures",
  "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa.jsonl"
);

const EXPECTED_FILES = [
  "commands.md",
  "handoff.md",
  "redaction-report.md",
  "session.json",
  "state.json",
  "timeline.md"
];

let projectPath = "";
let taskPath = "";

beforeAll(async () => {
  projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-claude-handoff-"));
  const session = await parseClaudeSession(FIXTURE);
  session.meta.projectPath = projectPath;

  await createHandoff(session, "codex", false);

  const tasksPath = path.join(projectPath, ".hamma", "tasks");
  const taskNames = await fs.readdir(tasksPath);
  expect(taskNames).toHaveLength(1);
  taskPath = path.join(tasksPath, taskNames[0]);
});

afterAll(async () => {
  if (projectPath) await fs.rm(projectPath, { recursive: true, force: true });
});

describe("createHandoff with a Claude session", () => {
  it("uses the claude-to-codex task directory name and writes all artifacts", async () => {
    expect(path.basename(taskPath)).toMatch(
      /^\d{4}-\d{2}-\d{2}T.+-claude-to-codex$/
    );
    expect((await fs.readdir(taskPath)).sort()).toEqual(EXPECTED_FILES);
  });

  it("identifies Claude as the source and Codex as the target", async () => {
    const handoff = await fs.readFile(path.join(taskPath, "handoff.md"), "utf8");
    expect(handoff).toContain("Source CLI: claude");
    expect(handoff).toContain("Target CLI: codex");
    expect(handoff).toContain("Artifact schema version: 1");
  });

  it("writes a versioned state artifact", async () => {
    const state = JSON.parse(
      await fs.readFile(path.join(taskPath, "state.json"), "utf8")
    );
    expect(state.schemaVersion).toBe(1);
  });

  it("keeps ignored Claude internal content out of session.json", async () => {
    const sessionJson = await fs.readFile(
      path.join(taskPath, "session.json"),
      "utf8"
    );

    expect(sessionJson).not.toContain("SYSTEM_PROMPT_DO_NOT_LEAK");
    expect(sessionJson).not.toContain("INTERNAL_THOUGHT_MUST_NOT_LEAK");
    expect(sessionJson).not.toContain("TOOL_RESULT_MUST_NOT_LEAK");
    expect(sessionJson).not.toContain("Do not surface this title");
  });
});

describe("atomic and safe handoff output", () => {
  it("publishes through a temporary directory and cleans it after collision failure", async () => {
    const isolatedProject = await fs.mkdtemp(
      path.join(os.tmpdir(), "hamma-atomic-handoff-")
    );
    const session = await parseClaudeSession(FIXTURE);
    session.meta.projectPath = isolatedProject;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T12:34:56.789Z"));

    try {
      await createHandoff(session, "codex", false);
      const expectedTask =
        "2026-07-02T12-34-56-789Z-claude-to-codex";
      const tasksPath = path.join(isolatedProject, ".hamma", "tasks");

      expect(await fs.readdir(tasksPath)).toEqual([expectedTask]);
      await expect(createHandoff(session, "codex", false)).rejects.toThrow(
        "Handoff task directory already exists"
      );
      expect(await fs.readdir(tasksPath)).toEqual([expectedTask]);
    } finally {
      vi.useRealTimers();
      await fs.rm(isolatedProject, { recursive: true, force: true });
    }
  });

  it("does not overwrite or clean up a pre-existing temporary directory", async () => {
    const isolatedProject = await fs.mkdtemp(
      path.join(os.tmpdir(), "hamma-existing-temp-")
    );
    const session = await parseClaudeSession(FIXTURE);
    session.meta.projectPath = isolatedProject;
    const taskId = "2026-07-02T12-34-56-789Z-claude-to-codex";
    const tempPath = path.join(
      isolatedProject,
      ".hamma",
      "tasks",
      `.tmp-${taskId}`
    );
    await fs.mkdir(tempPath, { recursive: true });
    await fs.writeFile(path.join(tempPath, "owner.txt"), "keep", "utf8");
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-02T12:34:56.789Z"));

    try {
      await expect(createHandoff(session, "codex", false)).rejects.toThrow(
        "Temporary handoff directory already exists"
      );
      await expect(
        fs.readFile(path.join(tempPath, "owner.txt"), "utf8")
      ).resolves.toBe("keep");
    } finally {
      vi.useRealTimers();
      await fs.rm(isolatedProject, { recursive: true, force: true });
    }
  });

  it("rejects target names instead of silently rewriting them", async () => {
    const isolatedProject = await fs.mkdtemp(
      path.join(os.tmpdir(), "hamma-unsafe-target-")
    );
    const session = await parseClaudeSession(FIXTURE);
    session.meta.projectPath = isolatedProject;

    try {
      await expect(createHandoff(session, "co/dex", false)).rejects.toThrow(
        "Invalid target CLI name 'co/dex'"
      );
      await expect(
        fs.access(path.join(isolatedProject, ".hamma"))
      ).rejects.toMatchObject({ code: "ENOENT" });
    } finally {
      await fs.rm(isolatedProject, { recursive: true, force: true });
    }
  });

  it("rejects relative project paths", async () => {
    const session = await parseClaudeSession(FIXTURE);
    session.meta.projectPath = "relative/project";

    await expect(createHandoff(session, "codex", false)).rejects.toThrow(
      "projectPath must be absolute"
    );
  });

  it("rejects a symbolic-link .hamma output directory", async () => {
    const isolatedProject = await fs.mkdtemp(
      path.join(os.tmpdir(), "hamma-symlink-project-")
    );
    const outside = await fs.mkdtemp(
      path.join(os.tmpdir(), "hamma-symlink-outside-")
    );
    const session = await parseClaudeSession(FIXTURE);
    session.meta.projectPath = isolatedProject;
    await fs.symlink(outside, path.join(isolatedProject, ".hamma"), "dir");

    try {
      await expect(createHandoff(session, "codex", false)).rejects.toThrow(
        ".hamma directory must not be a symbolic link"
      );
      expect(await fs.readdir(outside)).toEqual([]);
    } finally {
      await Promise.all([
        fs.rm(isolatedProject, { recursive: true, force: true }),
        fs.rm(outside, { recursive: true, force: true }),
      ]);
    }
  });
});

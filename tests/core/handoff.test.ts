import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
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

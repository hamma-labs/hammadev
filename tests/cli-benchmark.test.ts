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
const TASK_ID = "2026-07-18T10-00-00-000Z-claude-to-codex";
let projectPath = "";

beforeAll(async () => {
  projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-cli-benchmark-"));
  const taskPath = path.join(projectPath, ".hamma", "tasks", TASK_ID);
  await fs.mkdir(taskPath, { recursive: true });
  await fs.writeFile(path.join(taskPath, "handoff.md"), "handoff context");
  await fs.writeFile(path.join(taskPath, "state.json"), "state context");
  await fs.writeFile(path.join(taskPath, "tool_history.jsonl"), "tool context");
  await fs.writeFile(
    path.join(taskPath, "session.json"),
    JSON.stringify({
      meta: { sourceCli: "claude", sourceSessionId: "synthetic" },
      messages: [{ role: "user", content: "x".repeat(1_000) }],
      shellCommands: [],
      parserWarnings: [],
      security: { redacted: false, redactionCount: 0, warnings: [] },
    })
  );
});

afterAll(async () => {
  if (projectPath) await fs.rm(projectPath, { recursive: true, force: true });
});

describe("benchmark CLI", () => {
  it("renders a demo-friendly benchmark", async () => {
    const result = await execFileAsync(TSX, [CLI, "benchmark", "latest", "--project", projectPath], {
      cwd: ROOT,
    });
    expect(result.stdout).toContain("Context efficiency");
    expect(result.stdout).toContain("Effective continuation context");
    expect(result.stdout).toContain("Archive-only local artifacts");
    expect(result.stdout).toContain("not an exact provider-specific tokenizer count");
  });

  it("keeps JSON stdout machine-readable", async () => {
    const result = await execFileAsync(
      TSX,
      [CLI, "benchmark", TASK_ID, "--project", projectPath, "--json"],
      { cwd: ROOT }
    );
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      schemaVersion: 1,
      taskId: TASK_ID,
      source: { available: true, messageCount: 1 },
      estimationMethod: { exactTokenizer: false },
    });
    expect(output.effectiveContinuation.totalBytes).toBe(
      Buffer.byteLength("handoff contextstate contexttool context")
    );
  });
});

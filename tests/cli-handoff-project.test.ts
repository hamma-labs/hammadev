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

let fixtureRoot = "";
let projectPath = "";
let otherProjectPath = "";
let fakeHome = "";

async function writeClaudeSession(
  id: string,
  cwd: string,
  message: string,
  mtime: Date,
  assistant: string = "Implementation is in progress."
): Promise<void> {
  const sessionPath = path.join(
    fakeHome,
    ".claude",
    "projects",
    id,
    `${id}.jsonl`
  );
  const records = [
    {
      type: "user",
      uuid: `${id}-user`,
      timestamp: "2026-07-03T10:00:00Z",
      cwd,
      sessionId: id,
      message: { role: "user", content: message }
    },
    {
      type: "assistant",
      uuid: `${id}-assistant`,
      timestamp: "2026-07-03T10:01:00Z",
      sessionId: id,
      message: { role: "assistant", content: assistant }
    }
  ];
  await fs.mkdir(path.dirname(sessionPath), { recursive: true });
  await fs.writeFile(
    sessionPath,
    records.map((record) => JSON.stringify(record)).join("\n") + "\n",
    "utf8"
  );
  await fs.utimes(sessionPath, mtime, mtime);
}

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-cli-project-"));
  projectPath = path.join(fixtureRoot, "project");
  otherProjectPath = path.join(fixtureRoot, "unrelated");
  fakeHome = path.join(fixtureRoot, "home");
  await Promise.all([
    fs.mkdir(path.join(projectPath, "packages", "app"), { recursive: true }),
    fs.mkdir(otherProjectPath),
    fs.mkdir(fakeHome)
  ]);

  await writeClaudeSession(
    "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
    path.join(projectPath, "packages", "app"),
    "Continue the project-specific parser work.",
    new Date("2026-07-03T10:00:00Z")
  );
  await writeClaudeSession(
    "bbbbbbbb-2222-4bbb-8bbb-bbbbbbbbbbbb",
    otherProjectPath,
    "This belongs to another repository.",
    new Date("2026-07-03T11:00:00Z")
  );
  await writeClaudeSession(
    "cccccccc-3333-4ccc-8ccc-cccccccccccc",
    projectPath,
    "hi",
    new Date("2026-07-03T12:00:00Z"),
    "Please run /login · API Error: 403 account tier insufficient"
  );
  // Newest session, but a Hamma handoff invocation on itself → must be skipped.
  await writeClaudeSession(
    "dddddddd-4444-4ddd-8ddd-dddddddddddd",
    projectPath,
    "Base directory for this skill: /home/u/.claude/skills/hamma-handoff\n\n# Hamma Handoff\n\nRecover the newest Claude Code session and validate the generated handoff.",
    new Date("2026-07-03T13:00:00Z"),
    "Recovered a handoff."
  );
});

afterAll(async () => {
  if (fixtureRoot) {
    await fs.rm(fixtureRoot, { recursive: true, force: true });
  }
});

describe("handoff claude:project CLI command", () => {
  it("selects the current project's session and emits only JSON", async () => {
    const result = await execFileAsync(
      TSX,
      [
        CLI,
        "handoff",
        "claude:project",
        "--to",
        "codex",
        "--project",
        projectPath,
        "--json",
        "--no-gitignore"
      ],
      {
        cwd: projectPath,
        env: { ...process.env, HOME: fakeHome }
      }
    );

    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      schemaVersion: 1,
      sourceCli: "claude",
      sourceSessionId: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
      targetCli: "codex",
      projectPath
    });
    // Handoff surfaces its own quality assessment.
    expect(["high", "medium"]).toContain(output.confidence);
    expect(Array.isArray(output.warnings)).toBe(true);
    expect(output.signals).not.toContain("hamma-meta");
    expect(result.stdout).not.toContain("Handoff created at:");

    const handoff = await fs.readFile(output.handoffPath, "utf8");
    expect(handoff).toContain("Continue the project-specific parser work.");
    expect(handoff).not.toContain("This belongs to another repository.");
  });

  it("lists ranked project candidates without transcript content", async () => {
    const result = await execFileAsync(
      TSX,
      [
        CLI,
        "list",
        "claude",
        "--project",
        projectPath,
        "--json"
      ],
      {
        cwd: projectPath,
        env: { ...process.env, HOME: fakeHome }
      }
    );

    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({ schemaVersion: 1, projectPath });
    expect(output.candidates[0]).toMatchObject({
      sessionId: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
      resumable: true
    });
    const rejected = output.candidates.find(
      (candidate: any) =>
        candidate.sessionId === "cccccccc-3333-4ccc-8ccc-cccccccccccc"
    );
    expect(rejected).toMatchObject({
      confidence: "low",
      resumable: false
    });
    const meta = output.candidates.find(
      (candidate: any) =>
        candidate.sessionId === "dddddddd-4444-4ddd-8ddd-dddddddddddd"
    );
    expect(meta).toMatchObject({ confidence: "low", resumable: false });
    expect(meta.signals).toContain("hamma-meta");
    expect(result.stdout).not.toContain("Continue the project-specific parser work.");
  });

  it("claude:current snapshots the newest session; claude:previous self-excludes", async () => {
    const env = { ...process.env, HOME: fakeHome };

    // :current = newest-mtime session (dddd, the hamma-meta one) — unfiltered.
    const current = JSON.parse(
      (await execFileAsync(
        TSX,
        [CLI, "handoff", "claude:current", "--to", "claude", "--project", projectPath, "--json", "--no-gitignore"],
        { cwd: projectPath, env }
      )).stdout
    );
    expect(current.sourceSessionId).toBe("dddddddd-4444-4ddd-8ddd-dddddddddddd");
    expect(current.targetCli).toBe("claude");

    // :previous drops the current (dddd) and the non-resumable cccc, landing on aaaa.
    const previous = JSON.parse(
      (await execFileAsync(
        TSX,
        [CLI, "handoff", "claude:previous", "--to", "claude", "--project", projectPath, "--json", "--no-gitignore"],
        { cwd: projectPath, env }
      )).stdout
    );
    expect(previous.sourceSessionId).toBe("aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa");
    expect(previous.sourceSessionId).not.toBe(current.sourceSessionId);
  });
});

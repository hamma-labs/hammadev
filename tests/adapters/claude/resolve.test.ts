import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  listClaudeProjectCandidates,
  resolveClaudeTarget
} from "../../../src/adapters/claude/resolve.js";

let claudeHome = "";
const idA = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const idB = "aaaaaaaa-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const idC = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
const idD = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
const idE = "eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee";
const idF = "ffffffff-ffff-4fff-8fff-ffffffffffff";
let fileA = "";
let fileB = "";
let fileC = "";
let fileD = "";
let fileE = "";
let projectA = "";
let projectB = "";
let projectLowConfidence = "";

function sessionContents(
  sessionId: string,
  cwd: string,
  user: string,
  assistant: string = "Implementation is in progress."
): string {
  return [
    {
      type: "user",
      sessionId,
      cwd,
      message: { role: "user", content: user }
    },
    {
      type: "assistant",
      sessionId,
      message: { role: "assistant", content: assistant }
    }
  ].map((record) => JSON.stringify(record)).join("\n") + "\n";
}

async function write(rel: string, contents: string, mtime: Date) {
  const full = path.join(claudeHome, rel);
  await fs.mkdir(path.dirname(full), { recursive: true });
  await fs.writeFile(full, contents);
  await fs.utimes(full, mtime, mtime);
  return full;
}

beforeAll(async () => {
  claudeHome = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-claude-resolve-"));
  projectA = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-project-a-"));
  projectB = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-project-b-"));
  projectLowConfidence = await fs.mkdtemp(
    path.join(os.tmpdir(), "hamma-project-low-")
  );

  fileA = await write(
    `projects/-proj-a/${idA}.jsonl`,
    sessionContents(idA, projectA, "Implement the parser migration."),
    new Date("2026-06-01T00:00:00Z")
  );
  fileB = await write(
    `projects/-proj-b/${idB}.jsonl`,
    sessionContents(idB, projectA, "Fix the newest project parser tests."),
    new Date("2026-06-02T00:00:00Z")
  );
  const projectBSubdirectory = path.join(projectB, "packages", "app");
  await fs.mkdir(projectBSubdirectory, { recursive: true });
  fileC = await write(
    `projects/-proj-c/${idC}.jsonl`,
    sessionContents(idC, projectBSubdirectory, "Continue the app build."),
    new Date("2026-06-03T00:00:00Z")
  );
  fileD = await write(
    `projects/-proj-d/${idD}.jsonl`,
    sessionContents(
      idD,
      projectA,
      "hi",
      'Please run /login · API Error: 403 {"error":"account tier insufficient"}'
    ),
    new Date("2026-06-04T00:00:00Z")
  );
  await write(
    `projects/-proj-f/${idF}.jsonl`,
    sessionContents(
      idF,
      projectA,
      "Implement the authentication migration in src/auth.ts.",
      "API Error: 403 forbidden"
    ),
    new Date("2026-06-04T12:00:00Z")
  );
  fileE = await write(
    `projects/-proj-e/${idE}.jsonl`,
    sessionContents(
      idE,
      projectLowConfidence,
      "hello",
      "Authentication failed: unauthorized 401"
    ),
    new Date("2026-06-05T00:00:00Z")
  );
});

afterAll(async () => {
  await Promise.all(
    [claudeHome, projectA, projectB, projectLowConfidence]
      .filter(Boolean)
      .map((item) => fs.rm(item, { recursive: true, force: true }))
  );
});

describe("resolveClaudeTarget", () => {
  it("claude:last returns the newest session by mtime without quality filtering", async () => {
    const out = await resolveClaudeTarget("claude:last", {
      claudeHomes: [claudeHome]
    });
    expect(out).toBe(fileE);
  });

  it("claude:<exact-id> resolves the exact match", async () => {
    const out = await resolveClaudeTarget(`claude:${idA}`, {
      claudeHomes: [claudeHome]
    });
    expect(out).toBe(fileA);
  });

  it("claude:<unique-prefix> resolves when only one id matches", async () => {
    const out = await resolveClaudeTarget("claude:cccc", {
      claudeHomes: [claudeHome]
    });
    expect(out).toBe(fileC);
  });

  it("claude:project selects the newest substantive session", async () => {
    const out = await resolveClaudeTarget("claude:project", {
      claudeHomes: [claudeHome],
      projectPath: projectA
    });
    expect(out).toBe(fileB);
  });

  it("skips a newer trivial authentication-failure session", async () => {
    const result = await listClaudeProjectCandidates(projectA, [claudeHome]);

    expect(result.candidates[0].sessionId).toBe(idB);
    const rejected = result.candidates.find(
      (candidate) => candidate.sessionId === idD
    );
    expect(rejected).toMatchObject({
      confidence: "low",
      resumable: false
    });
    expect(rejected?.signals).toContain("authentication-failure");
    expect(rejected?.reasons).toContain("no meaningful user instruction");

    const failedTask = result.candidates.find(
      (candidate) => candidate.sessionId === idF
    );
    expect(failedTask).toMatchObject({
      confidence: "low",
      resumable: false
    });
    expect(failedTask?.reasons).toContain(
      "assistant output contains only an authentication failure"
    );
  });

  it("claude:project matches a session started in a project subdirectory", async () => {
    const out = await resolveClaudeTarget("claude:project", {
      claudeHomes: [claudeHome],
      projectPath: projectB
    });
    expect(out).toBe(fileC);
  });

  it("returns candidate metadata when no project session is resumable", async () => {
    await expect(
      resolveClaudeTarget("claude:project", {
        claudeHomes: [claudeHome],
        projectPath: projectLowConfidence
      })
    ).rejects.toThrow(
      new RegExp(
        `No resumable Claude session.*${idE}.*confidence low.*authentication-failure`,
        "s"
      )
    );
  });

  it("requires a project path for claude:project", async () => {
    await expect(
      resolveClaudeTarget("claude:project", { claudeHomes: [claudeHome] })
    ).rejects.toThrow(/requires a project path/);
  });

  it("reports when a project has no Claude session", async () => {
    const missingProject = await fs.mkdtemp(
      path.join(os.tmpdir(), "hamma-project-missing-")
    );
    try {
      await expect(
        resolveClaudeTarget("claude:project", {
          claudeHomes: [claudeHome],
          projectPath: missingProject
        })
      ).rejects.toThrow(/No Claude session found for project/);
    } finally {
      await fs.rm(missingProject, { recursive: true, force: true });
    }
  });

  it("throws a clear ambiguity error listing all matches", async () => {
    await expect(
      resolveClaudeTarget("claude:aaaaaaaa", { claudeHomes: [claudeHome] })
    ).rejects.toThrow(/Ambiguous Claude sessionId prefix 'aaaaaaaa'/);

    try {
      await resolveClaudeTarget("claude:aaaaaaaa", {
        claudeHomes: [claudeHome]
      });
    } catch (err: any) {
      expect(err.message).toContain(idA);
      expect(err.message).toContain(idB);
    }
  });

  it("throws not-found for an unknown id", async () => {
    await expect(
      resolveClaudeTarget("claude:zzzzzzzz", { claudeHomes: [claudeHome] })
    ).rejects.toThrow(/No Claude session found with sessionId matching 'zzzzzzzz'/);
  });

  it("throws a clear error when no Claude sessions exist at all", async () => {
    const empty = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-claude-empty-"));
    try {
      await expect(
        resolveClaudeTarget("claude:last", { claudeHomes: [empty] })
      ).rejects.toThrow(/No Claude Code session files found/);
    } finally {
      await fs.rm(empty, { recursive: true, force: true });
    }
  });

  it("rejects a non-claude: target", async () => {
    await expect(resolveClaudeTarget("codex:last")).rejects.toThrow(
      /Invalid Claude target/
    );
  });
});

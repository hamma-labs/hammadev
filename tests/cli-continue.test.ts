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
let fakeHome = "";

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-continue-"));
  projectPath = path.join(fixtureRoot, "project");
  fakeHome = path.join(fixtureRoot, "home");
  const id = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
  const sessionPath = path.join(
    fakeHome,
    ".claude",
    "projects",
    id,
    `${id}.jsonl`
  );
  await fs.mkdir(projectPath, { recursive: true });
  await fs.mkdir(path.dirname(sessionPath), { recursive: true });
  await fs.writeFile(
    sessionPath,
    [
      {
        type: "user",
        sessionId: id,
        cwd: projectPath,
        timestamp: "2026-07-18T10:00:00Z",
        message: {
          role: "user",
          content: "Implement the continuation workflow in src/continuation.ts and add tests.",
        },
      },
      {
        type: "assistant",
        sessionId: id,
        timestamp: "2026-07-18T10:01:00Z",
        message: {
          role: "assistant",
          content: "Implementation is in progress; the build still needs verification.",
        },
      },
    ].map((record) => JSON.stringify(record)).join("\n") + "\n",
    "utf8"
  );
});

afterAll(async () => {
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("continue CLI command", () => {
  it("explains the best cross-agent session in JSON without writing a handoff", async () => {
    const result = await execFileAsync(
      TSX,
      [
        CLI,
        "continue",
        "--to",
        "codex",
        "--project",
        projectPath,
        "--explain",
        "--json",
      ],
      { cwd: projectPath, env: { ...process.env, HOME: fakeHome } }
    );
    const output = JSON.parse(result.stdout);
    expect(output).toMatchObject({
      schemaVersion: 1,
      projectPath,
      targetCli: "codex",
      excludedSources: ["codex"],
      selected: {
        sourceCli: "claude",
        sessionId: "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
        resumable: true,
      },
    });
    expect(output.explanation.join(" ")).toContain("Quality ranks before recency");
    expect(output.preflight).toMatchObject({
      schemaVersion: 1,
      outcome: "actionable",
      taskEpoch: {
        startMessageIndex: 0,
        basis: "latest_substantive_user",
      },
    });
    await expect(fs.stat(path.join(projectPath, ".hamma"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });

  it("withholds handoff creation when the latest task epoch is complete", async () => {
    const id = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
    const sessionPath = path.join(
      fakeHome,
      ".claude",
      "projects",
      id,
      `${id}.jsonl`
    );
    await fs.appendFile(
      sessionPath,
      `${JSON.stringify({
        type: "assistant",
        sessionId: id,
        timestamp: "2026-07-18T10:02:00Z",
        message: {
          role: "assistant",
          content: "The continuation workflow is now fully complete. All tests passed.",
        },
      })}\n`,
      "utf8"
    );

    const result = await execFileAsync(
      TSX,
      [
        CLI,
        "continue",
        "--to",
        "codex",
        "--project",
        projectPath,
        "--json",
      ],
      { cwd: projectPath, env: { ...process.env, HOME: fakeHome } }
    );
    const output = JSON.parse(result.stdout);

    expect(output).toMatchObject({
      schemaVersion: 1,
      preflight: {
        outcome: "completed",
        shouldCreateHandoff: false,
        requiresForce: true,
        recommendation: expect.stringContaining("No continuation required"),
      },
      handoff: null,
    });
    await expect(fs.stat(path.join(projectPath, ".hamma"))).rejects.toMatchObject({
      code: "ENOENT",
    });
  });
});

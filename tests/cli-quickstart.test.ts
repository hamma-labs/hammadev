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

async function run(args: string[], cwd: string): Promise<string> {
  const result = await execFileAsync(TSX, [CLI, ...args], {
    cwd,
    env: { ...process.env, HOME: fakeHome },
  });
  return result.stdout;
}

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-cli-quickstart-"));
  projectPath = path.join(fixtureRoot, "project");
  fakeHome = path.join(fixtureRoot, "home");
  await Promise.all([
    fs.mkdir(projectPath),
    fs.mkdir(fakeHome),
  ]);

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

describe("quickstart CLI command", () => {
  it("outputs a friendly onboarding message with next steps", async () => {
    const output = await run(["quickstart"], projectPath);

    expect(output).toContain("HammaDev quickstart");
    expect(output).toContain(`Project:\n  ${projectPath}`);
    expect(output).toContain("Environment:");
    expect(output).toContain("Node: ok");
    expect(output).toContain("Git repo: no");
    
    // In CI this could be "n/a (git unavailable)" or "n/a (not a repo)" based on git presence.
    // The main thing is that we aren't throwing an error.
    expect(output).toMatch(/\.hamma ignored:/);

    expect(output).toContain("Detected agents:");
    expect(output).toContain("Codex sessions: 1");
    expect(output).toContain("Claude sessions: 1");

    expect(output).toContain("Try next:");
    expect(output).toContain("hamma handoff codex:last --to claude");
  });
});

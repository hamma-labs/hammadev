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

async function run(args: string[]): Promise<string> {
  return (await execFileAsync(TSX, [CLI, ...args], { cwd: projectPath })).stdout;
}

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-cli-setup-"));
  projectPath = path.join(fixtureRoot, "project");
  await fs.mkdir(projectPath);
  await execFileAsync("git", ["-C", projectPath, "init", "--quiet"]);
});

afterAll(async () => {
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("setup CLI", () => {
  it("previews without writing and applies only with explicit consent", async () => {
    const preview = JSON.parse(await run([
      "setup", "--check", "--agent", "all", "--bootstrap", "automatic", "--json",
    ]));
    expect(preview).toMatchObject({
      mode: "check",
      changesRequired: true,
      consentRequired: true,
      bootstrap: { requested: "automatic", applied: false },
    });
    expect(preview.hooks.every((entry: { dryRun: boolean }) => entry.dryRun)).toBe(true);
    await expect(fs.access(path.join(projectPath, ".hamma"))).rejects.toThrow();

    const applied = JSON.parse(await run([
      "setup", "--apply", "--agent", "all", "--bootstrap", "automatic", "--json",
    ]));
    expect(applied).toMatchObject({
      mode: "apply",
      consentRequired: false,
      changesRequired: false,
      changesApplied: true,
      bootstrap: { requested: "automatic", applied: true },
      environment: { hammaIgnored: true },
    });
    expect(applied.verification.every((entry: { verified: boolean }) => entry.verified)).toBe(true);
    await fs.access(path.join(projectPath, ".hamma", "config.json"));
    await fs.access(path.join(projectPath, ".claude", "settings.local.json"));
    await fs.access(path.join(projectPath, ".codex", "hooks.json"));
    await fs.access(path.join(projectPath, ".grok", "hooks", "hamma-memory.json"));
  });

  it("rejects contradictory consent flags", async () => {
    await expect(run(["setup", "--check", "--apply", "--json"]))
      .rejects.toThrow(/Use either --check or --apply/);
  });
});

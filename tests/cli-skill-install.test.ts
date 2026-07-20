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

let codexHome = "";

beforeAll(async () => {
  codexHome = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-cli-skill-"));
});

afterAll(async () => {
  if (codexHome) await fs.rm(codexHome, { recursive: true, force: true });
});

describe("skill install CLI command", () => {
  it("installs the full skill set for Codex and emits JSON", async () => {
    const result = await execFileAsync(
      TSX,
      [CLI, "skill", "install", "--agent", "codex", "--codex-home", codexHome, "--json"],
      { cwd: ROOT }
    );
    const output = JSON.parse(result.stdout);

    const names = output.installs.map((i: { skillName: string }) => i.skillName).sort();
    expect(names).toEqual(["hamma-handoff", "hamma-resume", "hamma-snap"]);
    for (const install of output.installs) {
      expect(install).toMatchObject({ agent: "codex", replaced: false, restartRequired: true });
      const skill = await fs.readFile(
        path.join(install.destination, "SKILL.md"),
        "utf8"
      );
      expect(skill).toContain(`name: ${install.skillName}`);
      if (install.skillName === "hamma-handoff") {
        expect(skill).toContain("hamma switch THIS --no-save --no-launch");
        expect(skill).toContain("executionMode");
        expect(skill).toContain("bootstrap.md");
      }
      if (install.skillName === "hamma-resume") {
        expect(skill).toContain("--preflight --compact-json");
        expect(skill).toContain('"resumed": false');
        expect(skill).not.toContain(
          'handoff THIS:previous --to THIS --project "<root>" --json'
        );
      }
    }
  });

  it("installs into both agents when --agent both is used", async () => {
    const bothCodexHome = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-cli-both-codex-"));
    const bothClaudeHome = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-cli-both-claude-"));
    try {
      const result = await execFileAsync(
        TSX,
        [
          CLI, "skill", "install",
          "--agent", "both",
          "--codex-home", bothCodexHome,
          "--claude-home", bothClaudeHome,
          "--json"
        ],
        { cwd: ROOT }
      );
      const output = JSON.parse(result.stdout);
      // 3 skills × 2 agents
      expect(output.installs).toHaveLength(6);
      const agents = new Set(output.installs.map((i: { agent: string }) => i.agent));
      expect([...agents].sort()).toEqual(["claude", "codex"]);
      for (const [home, skill] of [
        [bothClaudeHome, "hamma-handoff"], [bothClaudeHome, "hamma-snap"], [bothClaudeHome, "hamma-resume"],
        [bothCodexHome, "hamma-handoff"], [bothCodexHome, "hamma-snap"], [bothCodexHome, "hamma-resume"],
      ] as const) {
        await expect(
          fs.readFile(path.join(home, "skills", skill, "SKILL.md"), "utf8")
        ).resolves.toContain(`name: ${skill}`);
      }
    } finally {
      await Promise.all([
        fs.rm(bothCodexHome, { recursive: true, force: true }),
        fs.rm(bothClaudeHome, { recursive: true, force: true })
      ]);
    }
  });
});

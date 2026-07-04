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
  it("installs the repository skill for Codex and emits JSON", async () => {
    const result = await execFileAsync(
      TSX,
      [CLI, "skill", "install", "--agent", "codex", "--codex-home", codexHome, "--json"],
      { cwd: ROOT }
    );
    const output = JSON.parse(result.stdout);

    expect(output).toMatchObject({
      skillName: "hamma-handoff",
      agent: "codex",
      destination: path.join(codexHome, "skills", "hamma-handoff"),
      replaced: false,
      restartRequired: true
    });
    await expect(
      fs.readFile(path.join(output.destination, "SKILL.md"), "utf8")
    ).resolves.toContain("name: hamma-handoff");
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
      expect(output.installs).toHaveLength(2);
      const agents = output.installs.map((i: { agent: string }) => i.agent).sort();
      expect(agents).toEqual(["claude", "codex"]);
      await expect(
        fs.readFile(path.join(bothClaudeHome, "skills", "hamma-handoff", "SKILL.md"), "utf8")
      ).resolves.toContain("name: hamma-handoff");
      await expect(
        fs.readFile(path.join(bothCodexHome, "skills", "hamma-handoff", "SKILL.md"), "utf8")
      ).resolves.toContain("name: hamma-handoff");
    } finally {
      await Promise.all([
        fs.rm(bothCodexHome, { recursive: true, force: true }),
        fs.rm(bothClaudeHome, { recursive: true, force: true })
      ]);
    }
  });
});

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  installCodexSkill,
  installClaudeSkill,
} from "../../src/core/skill-install.js";

const temporaryDirectories: string[] = [];

async function temporaryDirectory(prefix: string): Promise<string> {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

async function createSkillSource(): Promise<string> {
  const source = await temporaryDirectory("hamma-skill-source-");
  await fs.mkdir(path.join(source, "agents"));
  await fs.writeFile(
    path.join(source, "SKILL.md"),
    "---\nname: hamma-handoff\ndescription: test\n---\n",
    "utf8"
  );
  await fs.writeFile(
    path.join(source, "agents", "openai.yaml"),
    'interface:\n  display_name: "Hamma Handoff"\n',
    "utf8"
  );
  return source;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      fs.rm(directory, { recursive: true, force: true })
    )
  );
});

describe("installCodexSkill", () => {
  it("installs the packaged skill into the selected Codex home", async () => {
    const sourcePath = await createSkillSource();
    const codexHome = await temporaryDirectory("hamma-codex-home-");

    const result = await installCodexSkill({ sourcePath, codexHome });

    expect(result).toEqual({
      skillName: "hamma-handoff",
      agent: "codex",
      destination: path.join(codexHome, "skills", "hamma-handoff"),
      replaced: false,
      restartRequired: true
    });
    await expect(
      fs.readFile(path.join(result.destination, "SKILL.md"), "utf8")
    ).resolves.toContain("name: hamma-handoff");
  });

  it("refuses to overwrite an installed skill without --force", async () => {
    const sourcePath = await createSkillSource();
    const codexHome = await temporaryDirectory("hamma-codex-home-");
    await installCodexSkill({ sourcePath, codexHome });

    await expect(
      installCodexSkill({ sourcePath, codexHome })
    ).rejects.toThrow(/already installed/);
  });

  it("atomically replaces an installed skill when forced", async () => {
    const sourcePath = await createSkillSource();
    const codexHome = await temporaryDirectory("hamma-codex-home-");
    const first = await installCodexSkill({ sourcePath, codexHome });
    await fs.writeFile(path.join(first.destination, "stale.txt"), "stale", "utf8");

    const result = await installCodexSkill({
      sourcePath,
      codexHome,
      force: true
    });

    expect(result.replaced).toBe(true);
    await expect(
      fs.access(path.join(result.destination, "stale.txt"))
    ).rejects.toMatchObject({ code: "ENOENT" });
  });

  it("rejects an incomplete packaged skill", async () => {
    const sourcePath = await temporaryDirectory("hamma-skill-incomplete-");
    const codexHome = await temporaryDirectory("hamma-codex-home-");

    await expect(
      installCodexSkill({ sourcePath, codexHome })
    ).rejects.toThrow(/missing SKILL.md/);
  });
});

describe("installClaudeSkill", () => {
  it("installs into the selected Claude home and tags the agent", async () => {
    const sourcePath = await createSkillSource();
    const claudeHome = await temporaryDirectory("hamma-claude-home-");

    const result = await installClaudeSkill({ sourcePath, home: claudeHome });

    expect(result).toEqual({
      skillName: "hamma-handoff",
      agent: "claude",
      destination: path.join(claudeHome, "skills", "hamma-handoff"),
      replaced: false,
      restartRequired: true
    });
    await expect(
      fs.readFile(path.join(result.destination, "SKILL.md"), "utf8")
    ).resolves.toContain("name: hamma-handoff");
  });

  it("installs for Claude even when the Codex-only openai.yaml is absent", async () => {
    const sourcePath = await temporaryDirectory("hamma-skill-md-only-");
    await fs.writeFile(
      path.join(sourcePath, "SKILL.md"),
      "---\nname: hamma-handoff\ndescription: test\n---\n",
      "utf8"
    );
    const claudeHome = await temporaryDirectory("hamma-claude-home-");

    const result = await installClaudeSkill({ sourcePath, home: claudeHome });
    expect(result.agent).toBe("claude");

    // Codex requires openai.yaml, so the same incomplete source must be rejected.
    const codexHome = await temporaryDirectory("hamma-codex-home-");
    await expect(
      installCodexSkill({ sourcePath, codexHome })
    ).rejects.toThrow(/missing/);
  });
});

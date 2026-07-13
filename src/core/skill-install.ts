import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_SKILL_NAME = "hamma-handoff";

export type SkillAgent = "codex" | "claude" | "grok";

export interface SkillInstallOptions {
  agent?: SkillAgent;
  /** Which packaged skill to install (folder name under skills/). */
  skillName?: string;
  /** Home directory of the target agent (e.g. ~/.codex or ~/.claude). */
  home?: string;
  /** @deprecated use `home`. Retained for backwards compatibility. */
  codexHome?: string;
  force?: boolean;
  /** Override the source skill folder (defaults to the packaged skill). */
  sourcePath?: string;
}

export interface SkillInstallResult {
  skillName: string;
  agent: SkillAgent;
  destination: string;
  replaced: boolean;
  restartRequired: true;
}

// Files that every agent needs vs. agent-specific extras. openai.yaml is a
// Codex manifest and is not required by Claude Code.
const REQUIRED_ENTRIES: Record<SkillAgent, string[]> = {
  codex: ["SKILL.md", path.join("agents", "openai.yaml")],
  claude: ["SKILL.md"],
  grok: ["SKILL.md"],  // Grok consumes universal artifacts; may be placed under ~/.grok/skills or used directly via suggested command
};

function packagedSkillsRoot(): string {
  const moduleDir = path.dirname(fileURLToPath(import.meta.url));
  return path.resolve(moduleDir, "..", "..", "skills");
}

function packagedSkillPath(skillName: string): string {
  return path.join(packagedSkillsRoot(), skillName);
}

function defaultAgentHome(agent: SkillAgent): string {
  if (agent === "codex") {
    return process.env.CODEX_HOME ?? path.join(os.homedir(), ".codex");
  }
  if (agent === "grok") {
    return process.env.GROK_HOME ?? path.join(os.homedir(), ".grok");
  }
  return process.env.CLAUDE_HOME ?? path.join(os.homedir(), ".claude");
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.lstat(target);
    return true;
  } catch (error: any) {
    if (error.code === "ENOENT") return false;
    throw error;
  }
}

async function validateSkillSource(
  sourcePath: string,
  agent: SkillAgent
): Promise<void> {
  for (const relative of REQUIRED_ENTRIES[agent]) {
    const target = path.join(sourcePath, relative);
    let stat;
    try {
      stat = await fs.stat(target);
    } catch (error: any) {
      if (error.code === "ENOENT") {
        throw new Error(`Packaged skill is incomplete: missing ${relative}.`);
      }
      throw error;
    }
    if (!stat.isFile()) {
      throw new Error(`Packaged skill entry is not a file: ${relative}.`);
    }
  }
}

/** Discover packaged skill folder names (any subfolder of skills/ with a SKILL.md). */
export async function discoverPackagedSkills(): Promise<string[]> {
  const root = packagedSkillsRoot();
  let entries;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (error: any) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
  const names: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await exists(path.join(root, entry.name, "SKILL.md"))) {
      names.push(entry.name);
    }
  }
  return names.sort();
}

export async function installSkill(
  options: SkillInstallOptions = {}
): Promise<SkillInstallResult> {
  const agent = options.agent ?? "codex";
  const skillName = options.skillName ?? DEFAULT_SKILL_NAME;
  const sourcePath = path.resolve(
    options.sourcePath ?? packagedSkillPath(skillName)
  );
  await validateSkillSource(sourcePath, agent);

  const agentHome = path.resolve(
    options.home ?? options.codexHome ?? defaultAgentHome(agent)
  );
  const skillsRoot = path.join(agentHome, "skills");
  const destination = path.join(skillsRoot, skillName);
  const suffix = `${process.pid}-${Date.now()}`;
  const staging = path.join(skillsRoot, `.${skillName}.tmp-${suffix}`);
  const backup = path.join(skillsRoot, `.${skillName}.backup-${suffix}`);

  await fs.mkdir(skillsRoot, { recursive: true });
  const replaced = await exists(destination);
  if (replaced && !options.force) {
    throw new Error(
      `Skill already installed at ${destination}. Re-run with --force to replace it.`
    );
  }

  await fs.cp(sourcePath, staging, {
    recursive: true,
    force: false,
    errorOnExist: true
  });

  let backedUp = false;
  try {
    if (replaced) {
      await fs.rename(destination, backup);
      backedUp = true;
    }
    await fs.rename(staging, destination);
    if (backedUp) await fs.rm(backup, { recursive: true, force: true });
  } catch (error) {
    await fs.rm(staging, { recursive: true, force: true }).catch(() => undefined);
    if (backedUp && !(await exists(destination))) {
      await fs.rename(backup, destination).catch(() => undefined);
    }
    throw error;
  }

  return {
    skillName,
    agent,
    destination,
    replaced,
    restartRequired: true
  };
}

/** Install every packaged skill for one agent. */
export async function installAllSkills(
  options: Omit<SkillInstallOptions, "skillName" | "sourcePath"> = {}
): Promise<SkillInstallResult[]> {
  const skillNames = await discoverPackagedSkills();
  const results: SkillInstallResult[] = [];
  for (const skillName of skillNames) {
    results.push(await installSkill({ ...options, skillName }));
  }
  return results;
}

/** @deprecated use installSkill({ agent: "codex" }). */
export async function installCodexSkill(
  options: Omit<SkillInstallOptions, "agent"> = {}
): Promise<SkillInstallResult> {
  return installSkill({ ...options, agent: "codex" });
}

export async function installClaudeSkill(
  options: Omit<SkillInstallOptions, "agent"> = {}
): Promise<SkillInstallResult> {
  return installSkill({ ...options, agent: "claude" });
}

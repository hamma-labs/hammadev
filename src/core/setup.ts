import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";
import { ensureGitignore } from "./handoff.js";
import {
  HOOK_AGENTS,
  HookAgent,
  HookInstallResult,
  installHooks,
} from "./hooks-install.js";
import {
  BootstrapMode,
  getBootstrapMode,
  setBootstrapMode,
} from "./project-config.js";
import { commandAvailable } from "./quickstart.js";
import { isNodeVersionSupported, MIN_NODE_VERSION } from "./runtime.js";

const execFileAsync = promisify(execFile);

export interface SetupOptions {
  agents?: HookAgent[];
  bootstrapMode?: BootstrapMode;
  apply?: boolean;
  force?: boolean;
  sharedClaude?: boolean;
  availability?: Partial<Record<HookAgent, boolean>>;
}

export interface SetupResult {
  schemaVersion: 1;
  mode: "check" | "apply";
  projectPath: string;
  environment: {
    node: { ok: boolean; version: string; minimum: string };
    git: { ok: boolean; version?: string };
    gitRepository: boolean;
    hammaIgnored: boolean;
    agents: Array<{ agent: HookAgent; installed: boolean }>;
  };
  selectedAgents: HookAgent[];
  bootstrap: {
    previous: BootstrapMode;
    requested: BootstrapMode;
    changed: boolean;
    applied: boolean;
  };
  hooks: HookInstallResult[];
  verification: Array<{
    agent: HookAgent;
    verified: boolean;
    settingsPath: string;
    warnings: string[];
  }>;
  changesRequired: boolean;
  changesApplied: boolean;
  consentRequired: boolean;
  ready: boolean;
  warnings: string[];
  nextCommand?: string;
}

async function gitVersion(): Promise<string | undefined> {
  try {
    return (await execFileAsync("git", ["--version"])).stdout.trim();
  } catch {
    return undefined;
  }
}

async function isGitRepository(projectPath: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["-C", projectPath, "rev-parse", "--is-inside-work-tree"]);
    return true;
  } catch {
    return false;
  }
}

async function isHammaIgnored(projectPath: string): Promise<boolean> {
  try {
    await execFileAsync("git", ["-C", projectPath, "check-ignore", "-q", ".hamma/"]);
    return true;
  } catch {
    return false;
  }
}

async function agentAvailability(
  injected: SetupOptions["availability"]
): Promise<Record<HookAgent, boolean>> {
  const entries = await Promise.all(HOOK_AGENTS.map(async (agent) => [
    agent,
    injected?.[agent] ?? await commandAvailable(agent),
  ] as const));
  return Object.fromEntries(entries) as Record<HookAgent, boolean>;
}

function normalizedAgents(
  requested: HookAgent[] | undefined,
  availability: Record<HookAgent, boolean>
): HookAgent[] {
  const selected = requested ?? HOOK_AGENTS.filter((agent) => availability[agent]);
  return [...new Set(selected)].sort((left, right) => left.localeCompare(right));
}

export function parseSetupAgents(value: string | undefined): HookAgent[] | undefined {
  if (!value || value.trim().toLowerCase() === "detected") return undefined;
  if (value.trim().toLowerCase() === "all") return [...HOOK_AGENTS];
  const agents = value.split(",").map((entry) => entry.trim().toLowerCase()).filter(Boolean);
  if (agents.length === 0 || agents.some((agent) => !HOOK_AGENTS.includes(agent as HookAgent))) {
    throw new Error("Setup agents must be detected, all, or a comma-separated list of claude,codex,grok.");
  }
  return agents as HookAgent[];
}

export async function runSetup(
  projectDirectory: string,
  options: SetupOptions = {}
): Promise<SetupResult> {
  const projectPath = path.resolve(projectDirectory);
  const apply = Boolean(options.apply);
  const requestedBootstrap = options.bootstrapMode ?? "manual";
  const [git, gitRepository, availability, previousBootstrap] = await Promise.all([
    gitVersion(),
    isGitRepository(projectPath),
    agentAvailability(options.availability),
    getBootstrapMode(projectPath),
  ]);
  const selectedAgents = normalizedAgents(options.agents, availability);
  const hookPlans: HookInstallResult[] = [];
  for (const agent of selectedAgents) {
    hookPlans.push(await installHooks({
      agent,
      projectPath,
      force: options.force,
      shared: agent === "claude" && options.sharedClaude,
      dryRun: true,
    }));
  }

  const hooks: HookInstallResult[] = [];
  if (apply) {
    for (const agent of selectedAgents) {
      hooks.push(await installHooks({
        agent,
        projectPath,
        force: options.force,
        shared: agent === "claude" && options.sharedClaude,
      }));
    }
  } else {
    hooks.push(...hookPlans);
  }

  const bootstrapChanged = previousBootstrap !== requestedBootstrap;
  if (apply && bootstrapChanged) await setBootstrapMode(projectPath, requestedBootstrap);
  if (apply && gitRepository) await ensureGitignore(projectPath);

  const verification: SetupResult["verification"] = [];
  for (const agent of selectedAgents) {
    const checked = await installHooks({
      agent,
      projectPath,
      force: options.force,
      shared: agent === "claude" && options.sharedClaude,
      dryRun: true,
    });
    verification.push({
      agent,
      verified:
        checked.installed.length === 0 &&
        checked.replaced.length === 0 &&
        checked.warnings.length === 0,
      settingsPath: checked.settingsPath,
      warnings: checked.warnings,
    });
  }

  const ignored = gitRepository ? await isHammaIgnored(projectPath) : false;
  const nodeVersion = process.versions.node;
  const nodeOk = isNodeVersionSupported(nodeVersion);
  const missingAgents = selectedAgents.filter((agent) => !availability[agent]);
  const warnings: string[] = [];
  if (!git) warnings.push("Git is not installed or not on PATH.");
  else if (!gitRepository) warnings.push("The selected project is not a Git repository.");
  if (!nodeOk) warnings.push(`Node.js ${MIN_NODE_VERSION}+ is required; detected ${nodeVersion}.`);
  if (selectedAgents.length === 0) {
    warnings.push("No supported agent was detected; install one or pass --agent explicitly.");
  }
  if (missingAgents.length > 0) {
    warnings.push(`Selected agent CLI not found on PATH: ${missingAgents.join(", ")}.`);
  }
  if (gitRepository && !ignored) warnings.push(".hamma/ is not ignored by Git.");
  for (const result of hooks) {
    warnings.push(...result.warnings.map((warning) => `${result.agent}: ${warning}`));
  }

  const hookChangesRequired = hooks.some((result) =>
    result.installed.length > 0 || result.replaced.length > 0
  );
  const changesPlanned = hookChangesRequired || bootstrapChanged || (gitRepository && !ignored);
  const environmentReady = Boolean(git) && gitRepository && nodeOk &&
    selectedAgents.length > 0 && missingAgents.length === 0;
  const configurationReady = verification.every((item) => item.verified) &&
    (!gitRepository || ignored) &&
    (apply || !bootstrapChanged);
  const ready = environmentReady && configurationReady;
  const changesRequired = apply ? !configurationReady : changesPlanned;

  return {
    schemaVersion: 1,
    mode: apply ? "apply" : "check",
    projectPath,
    environment: {
      node: { ok: nodeOk, version: nodeVersion, minimum: MIN_NODE_VERSION },
      git: { ok: Boolean(git), version: git },
      gitRepository,
      hammaIgnored: ignored,
      agents: HOOK_AGENTS.map((agent) => ({ agent, installed: availability[agent] })),
    },
    selectedAgents,
    bootstrap: {
      previous: previousBootstrap,
      requested: requestedBootstrap,
      changed: bootstrapChanged,
      applied: apply && bootstrapChanged,
    },
    hooks,
    verification,
    changesRequired,
    changesApplied: apply && changesPlanned,
    consentRequired: !apply && changesRequired,
    ready,
    warnings,
    nextCommand: !apply && changesRequired && selectedAgents.length > 0
      ? `hamma setup --apply --agent ${selectedAgents.length === HOOK_AGENTS.length ? "all" : selectedAgents.join(",")} --bootstrap ${requestedBootstrap}`
      : ready
        ? "hamma save"
        : undefined,
  };
}

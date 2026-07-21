import fs from "node:fs/promises";
import path from "node:path";

// Writes the lifecycle hook entries documented in docs/memory-hooks.md into
// per-project agent settings files. Only hook entries whose command starts
// with "hamma " are ever created, replaced, or removed; every other key and
// hook group in a shared settings file is preserved verbatim.

export type HookAgent = "codex" | "claude" | "grok";

export const HOOK_AGENTS: HookAgent[] = ["claude", "codex", "grok"];

export interface HookInstallOptions {
  agent: HookAgent;
  /** Project root, pre-resolved via resolveMemoryProjectPath. */
  projectPath: string;
  /** Replace differing hamma-managed entries. Never rewrites invalid files. */
  force?: boolean;
  /** Claude only: write shared .claude/settings.json instead of settings.local.json. */
  shared?: boolean;
  /** Grok only: set false to skip the SessionStart bootstrap hook (installed by default). */
  sessionStart?: boolean;
}

export interface HookInstallResult {
  schemaVersion: 1;
  agent: HookAgent;
  settingsPath: string;
  created: boolean;
  installed: string[];
  replaced: string[];
  skipped: string[];
  warnings: string[];
}

export interface HookUninstallResult {
  schemaVersion: 1;
  agent: HookAgent;
  settingsPath: string;
  removed: string[];
  fileDeleted: boolean;
}

type JsonObject = Record<string, unknown>;

interface HookCommand {
  type: "command";
  command: string;
  timeout: number;
  statusMessage?: string;
}

interface HookGroup {
  hooks: HookCommand[];
}

const SYNC_TIMEOUT = 30;
const BOOTSTRAP_TIMEOUT = 10;

function syncHook(agent: HookAgent, statusMessage?: string): HookCommand {
  return {
    type: "command",
    command: `hamma memory sync --hook-agent ${agent} --no-gitignore`,
    timeout: SYNC_TIMEOUT,
    ...(statusMessage ? { statusMessage } : {}),
  };
}

function bootstrapHook(agent: HookAgent): HookCommand {
  return {
    type: "command",
    command: `hamma bootstrap --hook-agent ${agent}`,
    timeout: BOOTSTRAP_TIMEOUT,
  };
}

function desiredHooks(options: HookInstallOptions): Record<string, HookCommand> {
  if (options.agent === "claude") {
    return {
      PreCompact: syncHook("claude"),
      SessionEnd: syncHook("claude"),
      SessionStart: bootstrapHook("claude"),
    };
  }
  if (options.agent === "codex") {
    return {
      PreCompact: syncHook("codex", "Checkpointing active Hamma memory"),
      SessionStart: bootstrapHook("codex"),
    };
  }
  // SessionStart is included by default: `hamma grok` needs it to bind the
  // exact session, and the manual bootstrap mode keeps it silent for plain
  // grok starts, so unconditional injection is no longer a concern.
  return {
    PreCompact: syncHook("grok"),
    SessionEnd: syncHook("grok"),
    ...(options.sessionStart === false ? {} : { SessionStart: bootstrapHook("grok") }),
  };
}

export function hookSettingsPath(options: Pick<HookInstallOptions, "agent" | "projectPath" | "shared">): string {
  if (options.agent === "claude") {
    return path.join(
      options.projectPath,
      ".claude",
      options.shared ? "settings.json" : "settings.local.json"
    );
  }
  if (options.agent === "codex") {
    return path.join(options.projectPath, ".codex", "hooks.json");
  }
  return path.join(options.projectPath, ".grok", "hooks", "hamma-memory.json");
}

function isPlainObject(value: unknown): value is JsonObject {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isHammaHook(hook: unknown): boolean {
  return isPlainObject(hook) && typeof hook.command === "string" && hook.command.startsWith("hamma ");
}

function groupHasHammaHook(group: unknown): boolean {
  return isPlainObject(group) && Array.isArray(group.hooks) && group.hooks.some(isHammaHook);
}

function deepEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

async function readSettingsFile(target: string): Promise<{ value: JsonObject; created: boolean }> {
  let stats;
  try {
    stats = await fs.lstat(target);
  } catch (error: any) {
    if (error.code === "ENOENT") return { value: {}, created: true };
    throw error;
  }
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`Settings target is not a safe regular file: ${target}`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(await fs.readFile(target, "utf8"));
  } catch (error: any) {
    throw new Error(
      `Existing settings file ${target} is not valid JSON (${error.message}); fix or move it first.`
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Existing settings file ${target} must contain a JSON object.`);
  }
  return { value: parsed, created: false };
}

async function writeSettingsFile(target: string, value: JsonObject): Promise<void> {
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

function hooksObject(settings: JsonObject, target: string): JsonObject {
  if (settings.hooks === undefined) {
    settings.hooks = {};
  }
  if (!isPlainObject(settings.hooks)) {
    throw new Error(`Settings file ${target} has a non-object 'hooks' key; fix it first.`);
  }
  return settings.hooks;
}

function eventArray(hooks: JsonObject, event: string, target: string): unknown[] {
  if (hooks[event] === undefined) hooks[event] = [];
  if (!Array.isArray(hooks[event])) {
    throw new Error(`Settings file ${target} has a non-array 'hooks.${event}' key; fix it first.`);
  }
  return hooks[event];
}

export async function installHooks(options: HookInstallOptions): Promise<HookInstallResult> {
  const target = hookSettingsPath(options);
  await fs.mkdir(path.dirname(target), { recursive: true });
  const { value: settings, created } = await readSettingsFile(target);
  const desired = desiredHooks(options);
  const installed: string[] = [];
  const replaced: string[] = [];
  const skipped: string[] = [];
  const warnings: string[] = [];

  const hooks = hooksObject(settings, target);
  for (const [event, command] of Object.entries(desired)) {
    const groups = eventArray(hooks, event, target);
    const managed = groups.find(groupHasHammaHook) as HookGroup | undefined;
    if (!managed) {
      groups.push({ hooks: [command] });
      installed.push(event);
      continue;
    }
    const existing = managed.hooks.filter(isHammaHook);
    if (existing.length === 1 && deepEqual(existing[0], command)) {
      skipped.push(event);
      continue;
    }
    if (!options.force) {
      warnings.push(
        `hooks.${event} already has a different hamma-managed entry; re-run with --force to replace it.`
      );
      skipped.push(event);
      continue;
    }
    managed.hooks = [...managed.hooks.filter((hook) => !isHammaHook(hook)), command];
    replaced.push(event);
  }

  if (installed.length > 0 || replaced.length > 0) {
    await writeSettingsFile(target, settings);
  }
  return {
    schemaVersion: 1,
    agent: options.agent,
    settingsPath: target,
    created: created && (installed.length > 0 || replaced.length > 0),
    installed,
    replaced,
    skipped,
    warnings,
  };
}

export async function uninstallHooks(
  options: Pick<HookInstallOptions, "agent" | "projectPath" | "shared">
): Promise<HookUninstallResult> {
  const target = hookSettingsPath(options);
  const { value: settings, created } = await readSettingsFile(target);
  if (created || !isPlainObject(settings.hooks)) {
    return { schemaVersion: 1, agent: options.agent, settingsPath: target, removed: [], fileDeleted: false };
  }

  const hooks = settings.hooks;
  const removed: string[] = [];
  for (const [event, groups] of Object.entries(hooks)) {
    if (!Array.isArray(groups)) continue;
    let touched = false;
    const kept = groups
      .map((group) => {
        if (!groupHasHammaHook(group)) return group;
        touched = true;
        const remaining = (group as HookGroup).hooks.filter((hook) => !isHammaHook(hook));
        return remaining.length > 0 ? { ...(group as JsonObject), hooks: remaining } : undefined;
      })
      .filter((group) => group !== undefined);
    if (!touched) continue;
    removed.push(event);
    if (kept.length > 0) hooks[event] = kept;
    else delete hooks[event];
  }
  if (removed.length === 0) {
    return { schemaVersion: 1, agent: options.agent, settingsPath: target, removed, fileDeleted: false };
  }
  if (Object.keys(hooks).length === 0) delete settings.hooks;

  if (Object.keys(settings).length === 0) {
    await fs.rm(target, { force: true });
    return { schemaVersion: 1, agent: options.agent, settingsPath: target, removed, fileDeleted: true };
  }
  await writeSettingsFile(target, settings);
  return { schemaVersion: 1, agent: options.agent, settingsPath: target, removed, fileDeleted: false };
}

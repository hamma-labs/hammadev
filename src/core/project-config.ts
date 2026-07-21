import { promises as fs } from "node:fs";
import path from "node:path";

// Per-project Hamma settings stored at <project>/.hamma/config.json. Kept
// independent of memory-v2 on purpose: the config must stay readable and
// writable even when memory has never been enabled for the project.

export type BootstrapMode = "manual" | "automatic";

export const BOOTSTRAP_MODES: readonly BootstrapMode[] = ["manual", "automatic"];

// Manual is the product default: native SessionStart hooks stay silent unless
// the session was launched through a hamma wrapper (`hamma codex|claude|grok`).
export const DEFAULT_BOOTSTRAP_MODE: BootstrapMode = "manual";

export interface HammaProjectConfig {
  schemaVersion: 1;
  bootstrapMode?: BootstrapMode;
  updatedAt?: string;
  [key: string]: unknown;
}

const CONFIG_SCHEMA_VERSION = 1 as const;

export function projectConfigPath(projectPath: string): string {
  return path.join(path.resolve(projectPath), ".hamma", "config.json");
}

export function parseBootstrapMode(value: string): BootstrapMode {
  if ((BOOTSTRAP_MODES as readonly string[]).includes(value)) return value as BootstrapMode;
  throw new Error(
    `Invalid bootstrap mode '${value}'. Use 'manual' (memory context only for hamma-launched sessions) or 'automatic' (memory context in every session).`
  );
}

async function readSafeJson(target: string): Promise<unknown> {
  const stats = await fs.lstat(target);
  if (stats.isSymbolicLink() || !stats.isFile()) {
    throw new Error(`Project config is not a safe regular file: ${target}`);
  }
  return JSON.parse(await fs.readFile(target, "utf8"));
}

function validateConfig(parsed: unknown, target: string): HammaProjectConfig {
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`Project config must be a JSON object: ${target}`);
  }
  const config = parsed as Record<string, unknown>;
  if (config.schemaVersion !== CONFIG_SCHEMA_VERSION) {
    throw new Error(`Project config has unsupported schemaVersion: ${target}`);
  }
  if (config.bootstrapMode !== undefined && typeof config.bootstrapMode === "string") {
    parseBootstrapMode(config.bootstrapMode);
  } else if (config.bootstrapMode !== undefined) {
    throw new Error(`Project config has an invalid bootstrapMode: ${target}`);
  }
  return config as HammaProjectConfig;
}

export async function readProjectConfig(projectPath: string): Promise<HammaProjectConfig> {
  const target = projectConfigPath(projectPath);
  try {
    return validateConfig(await readSafeJson(target), target);
  } catch (error: any) {
    if (error.code === "ENOENT") return { schemaVersion: CONFIG_SCHEMA_VERSION };
    throw error;
  }
}

export async function getBootstrapMode(projectPath: string): Promise<BootstrapMode> {
  const config = await readProjectConfig(projectPath);
  return config.bootstrapMode ?? DEFAULT_BOOTSTRAP_MODE;
}

/**
 * Hook-path variant: never throws. A corrupt or unreadable config resolves to
 * the manual default, so a broken file fails closed (no context injection)
 * instead of breaking session start. `hamma config get` surfaces the error.
 */
export async function getBootstrapModeSafe(projectPath: string): Promise<BootstrapMode> {
  try {
    return await getBootstrapMode(projectPath);
  } catch {
    return DEFAULT_BOOTSTRAP_MODE;
  }
}

async function ensureHammaDirectory(projectPath: string): Promise<void> {
  const project = path.resolve(projectPath);
  const hammaRoot = path.join(project, ".hamma");
  try {
    await fs.mkdir(hammaRoot);
  } catch (error: any) {
    if (error.code !== "EEXIST") throw error;
  }
  const stats = await fs.lstat(hammaRoot);
  if (stats.isSymbolicLink() || !stats.isDirectory()) {
    throw new Error(`Project state directory is not a safe directory: ${hammaRoot}`);
  }
}

async function writeJsonAtomic(target: string, value: unknown): Promise<void> {
  const temporary = `${target}.tmp-${process.pid}-${Date.now()}`;
  await fs.writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { encoding: "utf8", flag: "wx" });
  try {
    await fs.rename(temporary, target);
  } catch (error) {
    await fs.rm(temporary, { force: true }).catch(() => undefined);
    throw error;
  }
}

export async function setBootstrapMode(
  projectPath: string,
  mode: BootstrapMode
): Promise<HammaProjectConfig> {
  const existing = await readProjectConfig(projectPath);
  const next: HammaProjectConfig = {
    ...existing,
    schemaVersion: CONFIG_SCHEMA_VERSION,
    bootstrapMode: mode,
    updatedAt: new Date().toISOString(),
  };
  await ensureHammaDirectory(projectPath);
  await writeJsonAtomic(projectConfigPath(projectPath), next);
  return next;
}

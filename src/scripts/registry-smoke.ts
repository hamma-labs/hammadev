import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { verifyCommandSurface } from "./command-surface.js";

const execFileAsync = promisify(execFile);

function requestedVersion(): string {
  const index = process.argv.indexOf("--version");
  const version = index >= 0 ? process.argv[index + 1] : process.env.HAMMA_REGISTRY_VERSION;
  if (!version || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/.test(version)) {
    throw new Error("Pass an exact package version with --version <semver>.");
  }
  return version;
}

async function installFromRegistry(version: string, root: string): Promise<void> {
  let lastError: unknown;
  const maximumAttempts = 36;
  for (let attempt = 1; attempt <= maximumAttempts; attempt += 1) {
    try {
      await execFileAsync("npm", [
        "install",
        "--ignore-scripts",
        "--no-audit",
        "--no-fund",
        "--prefix",
        root,
        `hammadev@${version}`,
      ], { maxBuffer: 4 * 1024 * 1024 });
      return;
    } catch (error) {
      lastError = error;
      if (attempt < maximumAttempts) {
        await new Promise((resolve) => setTimeout(resolve, 5_000));
      }
    }
  }
  throw lastError;
}

async function main(): Promise<void> {
  const version = requestedVersion();
  const temporaryRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-registry-smoke-"));
  try {
    await installFromRegistry(version, temporaryRoot);
    const executable = path.join(
      temporaryRoot,
      "node_modules",
      ".bin",
      process.platform === "win32" ? "hamma.cmd" : "hamma"
    );
    const installedVersion = (await execFileAsync(executable, ["--version"])).stdout.trim();
    if (installedVersion !== version) {
      throw new Error(`Registry installed ${installedVersion}; expected ${version}.`);
    }
    const surface = await verifyCommandSurface(executable);
    process.stdout.write(`${JSON.stringify({
      schemaVersion: 1,
      package: `hammadev@${version}`,
      source: "npm-registry",
      installedVersion,
      ...surface,
    }, null, 2)}\n`);
  } finally {
    await fs.rm(temporaryRoot, { recursive: true, force: true });
  }
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

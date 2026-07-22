import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export interface NpmRunOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  maxBuffer?: number;
}

async function isFile(target: string): Promise<boolean> {
  try {
    return (await fs.stat(target)).isFile();
  } catch {
    return false;
  }
}

export async function resolveNpmCli(
  nodeExecutable = process.execPath,
  environment: NodeJS.ProcessEnv = process.env
): Promise<string> {
  const executableDirectory = path.dirname(nodeExecutable);
  const configured = environment.NPM_CLI_JS;
  if (configured && !path.isAbsolute(configured)) {
    throw new Error("NPM_CLI_JS must be an absolute path to npm-cli.js.");
  }
  const inherited = environment.npm_execpath;
  const candidates = [
    configured,
    inherited &&
    path.isAbsolute(inherited) &&
    path.basename(inherited).toLowerCase() === "npm-cli.js"
      ? inherited
      : undefined,
    path.join(executableDirectory, "node_modules", "npm", "bin", "npm-cli.js"),
    path.resolve(
      executableDirectory,
      "..",
      "lib",
      "node_modules",
      "npm",
      "bin",
      "npm-cli.js"
    ),
    path.resolve(
      executableDirectory,
      "..",
      "share",
      "nodejs",
      "npm",
      "bin",
      "npm-cli.js"
    ),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (await isFile(candidate)) return candidate;
  }

  throw new Error(
    `Unable to locate npm-cli.js for ${nodeExecutable}. Set NPM_CLI_JS to its absolute path.`
  );
}

export async function runNpm(
  args: string[],
  options: NpmRunOptions = {}
): Promise<{ stdout: string; stderr: string }> {
  const npmCli = await resolveNpmCli(process.execPath, options.env ?? process.env);
  const result = await execFileAsync(process.execPath, [npmCli, ...args], {
    ...options,
    encoding: "utf8",
  });
  return { stdout: result.stdout, stderr: result.stderr };
}

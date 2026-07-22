import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

export interface ProductContract {
  schemaVersion: 1;
  topLevelCommands: string[];
  requiredCommandPaths: string[];
  installCommand: string;
  websiteCommands: Record<string, string>;
}

export async function loadProductContract(
  target = path.join(ROOT, "product-contract.json")
): Promise<ProductContract> {
  const contract = JSON.parse(await fs.readFile(target, "utf8")) as ProductContract;
  if (
    contract.schemaVersion !== 1 ||
    !Array.isArray(contract.topLevelCommands) ||
    !Array.isArray(contract.requiredCommandPaths) ||
    contract.installCommand !== "npm install -g hammadev@alpha" ||
    !contract.websiteCommands
  ) {
    throw new Error("product-contract.json has an unsupported shape.");
  }
  return contract;
}

export function parseTopLevelCommands(help: string): string[] {
  const commandsSection = help.split(/\nCommands:\s*\n/, 2)[1]?.split(/\n\n[^\s]/, 1)[0] ?? help;
  const commands = new Set<string>();
  for (const match of commandsSection.matchAll(/^  ([a-z][a-z-]*)(?=[\s[<]|$)/gm)) {
    if (match[1] !== "help") commands.add(match[1]);
  }
  return [...commands].sort();
}

export async function verifyCommandSurface(
  executable: string,
  suppliedContract?: ProductContract,
  executableArgs: string[] = []
): Promise<{ topLevelCommands: string[]; requiredCommandPaths: string[] }> {
  const contract = suppliedContract ?? await loadProductContract();
  const help = (await execFileAsync(executable, [...executableArgs, "--help"], {
    maxBuffer: 4 * 1024 * 1024,
  })).stdout;
  const actual = parseTopLevelCommands(help);
  const expected = [...contract.topLevelCommands].sort();
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `Installed CLI command surface differs from product-contract.json. Expected ${expected.join(", ")}; received ${actual.join(", ")}.`
    );
  }
  for (const commandPath of contract.requiredCommandPaths) {
    await execFileAsync(executable, [...executableArgs, ...commandPath.split(" "), "--help"], {
      maxBuffer: 4 * 1024 * 1024,
    });
  }
  for (const command of Object.values(contract.websiteCommands)) {
    const [binary, topLevel] = command.split(/\s+/);
    if (binary !== "hamma" || !contract.topLevelCommands.includes(topLevel)) {
      throw new Error(`Website command '${command}' is not represented by the CLI contract.`);
    }
  }
  return {
    topLevelCommands: actual,
    requiredCommandPaths: contract.requiredCommandPaths,
  };
}

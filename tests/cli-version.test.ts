import { expect, it } from "vitest";
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, "..");
const pkgPath = path.join(rootDir, "package.json");
const cliPath = path.join(rootDir, "dist", "cli.js");
const srcCliPath = path.join(rootDir, "src", "cli.ts");

it("CLI --version matches package.json version", () => {
  const pkg = JSON.parse(fs.readFileSync(pkgPath, "utf-8"));
  const expectedVersion = pkg.version;

  // Check dev CLI
  const devOutput = execSync(`npx tsx ${srcCliPath} --version`, { encoding: "utf-8", cwd: rootDir }).trim();
  expect(devOutput).toBe(expectedVersion);
  
  // Check built CLI if it exists
  if (fs.existsSync(cliPath)) {
    const prodOutput = execSync(`node ${cliPath} --version`, { encoding: "utf-8", cwd: rootDir }).trim();
    expect(prodOutput).toBe(expectedVersion);
  }
});

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

let fixtureRoot = "";
let projectPath = "";

async function run(args: string[], cwd = projectPath): Promise<string> {
  const result = await execFileAsync(TSX, [CLI, ...args], { cwd });
  return result.stdout;
}

beforeAll(async () => {
  fixtureRoot = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-cli-config-"));
  projectPath = path.join(fixtureRoot, "project");
  await fs.mkdir(projectPath, { recursive: true });
  await execFileAsync("git", ["-C", projectPath, "init", "-q"]);
});

afterAll(async () => {
  if (fixtureRoot) await fs.rm(fixtureRoot, { recursive: true, force: true });
});

describe("config CLI command", () => {
  it("shows the manual default before anything is stored", async () => {
    const stdout = await run(["config", "get"]);
    expect(stdout).toContain("bootstrap: manual");
    expect(stdout).toContain("(default)");

    const json = JSON.parse(await run(["config", "get", "--json"]));
    expect(json).toMatchObject({
      schemaVersion: 1,
      config: { bootstrap: { value: "manual", source: "default" } },
    });
    expect(json.configPath.endsWith(path.join(".hamma", "config.json"))).toBe(true);
  });

  it("sets and reads back the bootstrap mode without memory enabled", async () => {
    const stdout = await run(["config", "set", "bootstrap", "automatic"]);
    expect(stdout).toContain("bootstrap set to 'automatic'");

    const json = JSON.parse(await run(["config", "get", "bootstrap", "--json"]));
    expect(json.config).toEqual({ bootstrap: { value: "automatic", source: "config" } });

    const stored = JSON.parse(await fs.readFile(
      path.join(projectPath, ".hamma", "config.json"),
      "utf8"
    ));
    expect(stored.bootstrapMode).toBe("automatic");
    // Setting config must not enable memory.
    await expect(fs.access(path.join(projectPath, ".hamma", "memories"))).rejects.toThrow();
  });

  it("resolves the project to the git toplevel from a subdirectory", async () => {
    const nested = path.join(projectPath, "src", "deep");
    await fs.mkdir(nested, { recursive: true });
    const json = JSON.parse(await run(["config", "get", "bootstrap", "--json"], nested));
    expect(json.projectPath).toBe(await fs.realpath(projectPath));
    expect(json.config.bootstrap.value).toBe("automatic");
  });

  it("rejects an unknown setting and an invalid value", async () => {
    await expect(run(["config", "get", "nonsense"])).rejects.toThrow(/Unknown setting 'nonsense'/);
    await expect(run(["config", "set", "nonsense", "x"])).rejects.toThrow(/Unknown setting 'nonsense'/);
    await expect(run(["config", "set", "bootstrap", "always"]))
      .rejects.toThrow(/Invalid bootstrap mode 'always'/);
  });

  it("surfaces a corrupt config file loudly on get", async () => {
    const target = path.join(projectPath, ".hamma", "config.json");
    const original = await fs.readFile(target, "utf8");
    try {
      await fs.writeFile(target, "{ not valid json\n");
      await expect(run(["config", "get"])).rejects.toThrow();
    } finally {
      await fs.writeFile(target, original);
    }
  });
});

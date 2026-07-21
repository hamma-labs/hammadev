import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  DEFAULT_BOOTSTRAP_MODE,
  getBootstrapMode,
  getBootstrapModeSafe,
  parseBootstrapMode,
  projectConfigPath,
  readProjectConfig,
  setBootstrapMode,
} from "../../src/core/project-config.js";

let projectPath = "";

beforeEach(async () => {
  projectPath = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-project-config-"));
});

afterEach(async () => {
  if (projectPath) await fs.rm(projectPath, { recursive: true, force: true });
});

describe("project config", () => {
  it("defaults to manual when no config file exists", async () => {
    expect(DEFAULT_BOOTSTRAP_MODE).toBe("manual");
    expect(await getBootstrapMode(projectPath)).toBe("manual");
    expect(await readProjectConfig(projectPath)).toEqual({ schemaVersion: 1 });
  });

  it("round-trips a set bootstrap mode", async () => {
    await setBootstrapMode(projectPath, "automatic");
    expect(await getBootstrapMode(projectPath)).toBe("automatic");
    const config = await readProjectConfig(projectPath);
    expect(config.bootstrapMode).toBe("automatic");
    expect(config.updatedAt).toBeTruthy();

    await setBootstrapMode(projectPath, "manual");
    expect(await getBootstrapMode(projectPath)).toBe("manual");
  });

  it("rejects unsupported bootstrap modes", () => {
    expect(() => parseBootstrapMode("always")).toThrow(/Invalid bootstrap mode 'always'/);
    expect(parseBootstrapMode("manual")).toBe("manual");
    expect(parseBootstrapMode("automatic")).toBe("automatic");
  });

  it("preserves unknown config keys across writes", async () => {
    await setBootstrapMode(projectPath, "automatic");
    const target = projectConfigPath(projectPath);
    const stored = JSON.parse(await fs.readFile(target, "utf8"));
    stored.futureSetting = { nested: true };
    await fs.writeFile(target, `${JSON.stringify(stored, null, 2)}\n`);

    await setBootstrapMode(projectPath, "manual");
    const updated = JSON.parse(await fs.readFile(target, "utf8"));
    expect(updated.futureSetting).toEqual({ nested: true });
    expect(updated.bootstrapMode).toBe("manual");
  });

  it("throws on corrupt JSON but fails closed via the safe getter", async () => {
    const target = projectConfigPath(projectPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "{ not valid json\n");
    await expect(readProjectConfig(projectPath)).rejects.toThrow();
    await expect(getBootstrapMode(projectPath)).rejects.toThrow();
    expect(await getBootstrapModeSafe(projectPath)).toBe("manual");
  });

  it("rejects an invalid stored bootstrapMode value", async () => {
    const target = projectConfigPath(projectPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, `${JSON.stringify({ schemaVersion: 1, bootstrapMode: "sometimes" })}\n`);
    await expect(getBootstrapMode(projectPath)).rejects.toThrow(/Invalid bootstrap mode/);
    expect(await getBootstrapModeSafe(projectPath)).toBe("manual");
  });

  it("rejects a symlinked config file", async () => {
    const target = projectConfigPath(projectPath);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(`${target}.real`, `${JSON.stringify({ schemaVersion: 1 })}\n`);
    await fs.symlink(`${target}.real`, target);
    await expect(readProjectConfig(projectPath)).rejects.toThrow(/not a safe regular file/);
    expect(await getBootstrapModeSafe(projectPath)).toBe("manual");
  });
});

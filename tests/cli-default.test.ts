import { execFile } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI = path.join(ROOT, "src", "cli.ts");
const TSX = path.join(ROOT, "node_modules", ".bin", "tsx");

describe("default CLI command", () => {
  it("runs quickstart when no subcommand is provided", async () => {
    const fixture = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-default-"));
    const project = path.join(fixture, "project");
    const home = path.join(fixture, "home");
    await Promise.all([fs.mkdir(project), fs.mkdir(home)]);

    try {
      const result = await execFileAsync(TSX, [CLI], {
        cwd: project,
        env: { ...process.env, HOME: home }
      });
      expect(result.stdout).toContain("HammaDev quickstart");
      expect(result.stdout).toContain("What is missing:");
      expect(result.stdout).toContain("Run next:");
    } finally {
      await fs.rm(fixture, { recursive: true, force: true });
    }
  });
});

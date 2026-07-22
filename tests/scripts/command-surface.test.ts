import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadProductContract, parseTopLevelCommands } from "../../src/scripts/command-surface.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("public command surface contract", () => {
  it("parses Commander help and excludes its built-in help command", () => {
    expect(parseTopLevelCommands([
      "Commands:",
      "  save [options]",
      "  memory [options]",
      "  help [command]",
    ].join("\n"))).toEqual(["memory", "save"]);
  });

  it("keeps every website command under a contracted top-level command", async () => {
    const contract = await loadProductContract();
    for (const command of Object.values(contract.websiteCommands)) {
      const [binary, topLevel] = command.split(/\s+/);
      expect(binary).toBe("hamma");
      expect(contract.topLevelCommands).toContain(topLevel);
    }
  });

  it("keeps every public install surface pinned to the supported beta tag", async () => {
    const contract = await loadProductContract();
    expect(contract.installCommand).toBe("npm install -g hammadev@beta");
    const readme = await fs.readFile(path.join(ROOT, "README.md"), "utf8");
    expect(readme).toContain(contract.installCommand);
    expect(readme).not.toMatch(/npm install -g hammadev(?:\s|`|$)(?!@beta)/);
    const installComponent = await fs.readFile(
      path.join(ROOT, "website", "src", "components", "Install.tsx"),
      "utf8"
    );
    expect(installComponent).toContain("PRODUCT_INSTALL_COMMAND");
    expect(installComponent).not.toContain("npm install -g hammadev");
  });
});

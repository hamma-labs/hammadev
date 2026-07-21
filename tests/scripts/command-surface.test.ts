import { describe, expect, it } from "vitest";
import { loadProductContract, parseTopLevelCommands } from "../../src/scripts/command-surface.js";

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
});

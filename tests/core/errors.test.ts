import { describe, expect, it } from "vitest";
import { formatCliError } from "../../src/core/errors.js";

describe("formatCliError", () => {
  it("returns the plain error message without category prefix or URL", () => {
    const output = formatCliError("HANDOFF_ERROR", new Error("failed"));
    expect(output).toBe("failed");
    expect(output).not.toContain("[HANDOFF_ERROR]");
    expect(output).not.toContain("troubleshooting");
  });
});

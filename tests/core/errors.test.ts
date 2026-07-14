import { describe, expect, it } from "vitest";
import { formatCliError } from "../../src/core/errors.js";

describe("formatCliError", () => {
  it("uses a generic category and external troubleshooting URL", () => {
    const output = formatCliError("HANDOFF_ERROR", new Error("failed"));
    expect(output).toContain("[HANDOFF_ERROR] failed");
    expect(output).toContain("docs/troubleshooting.md#handoff_error");
  });
});

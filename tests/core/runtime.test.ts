import { describe, expect, it } from "vitest";
import { isNodeVersionSupported } from "../../src/core/runtime.js";

describe("Node.js runtime requirement", () => {
  it.each([
    ["19.9.0", false],
    ["20.0.0", false],
    ["20.11.0", false],
    ["22.11.0", false],
    ["22.12.0", true],
    ["22.12.1", true],
    ["23.0.0", true],
    ["24.0.0", true],
    ["invalid", false]
  ])("evaluates %s", (version, expected) => {
    expect(isNodeVersionSupported(version)).toBe(expected);
  });
});

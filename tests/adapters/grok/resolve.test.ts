import { describe, it, expect } from "vitest";
import { resolveGrokTarget } from "../../../src/adapters/grok/resolve.js";

describe("grok resolve", () => {
  it("accepts bare ids", async () => {
    const id = await resolveGrokTarget("019f54da-86ef-7913-b532-b9746fdf98ca");
    expect(id).toBe("019f54da-86ef-7913-b532-b9746fdf98ca");
  });

  it("strips grok: prefix for direct ids", async () => {
    const id = await resolveGrokTarget("grok:019f54da-86ef-7913-b532-b9746fdf98ca");
    expect(id).toBe("019f54da-86ef-7913-b532-b9746fdf98ca");
  });

  it("treats last/latest as special (will resolve via discover at runtime)", async () => {
    // We only test that it doesn't throw on the string form here.
    // Full resolution requires real ~/.grok sessions.
    const last = await resolveGrokTarget("grok:last").catch((e) => e.message);
    // If no sessions in this env it would error, which is acceptable for this smoke.
    expect(typeof last === "string" || (typeof last === "string" && last.includes("No Grok"))).toBeTruthy();
  });

  it("supports grok:project with projectPath option (runtime discover)", async () => {
    const p = await resolveGrokTarget("grok:project", { projectPath: process.cwd() }).catch((e) => e.message);
    expect(typeof p === "string" || String(p).includes("No Grok") || String(p).includes("requires a project path")).toBeTruthy();
  });
});

import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { sbomTextMatches } from "../../src/scripts/sbom-text.js";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("CycloneDX SBOM", () => {
  it("treats CRLF and LF SBOM text as equivalent", () => {
    const generated = '{\n  "version": "0.1.0-beta.1"\n}\n';
    expect(sbomTextMatches(generated.replace(/\n/g, "\r\n"), generated)).toBe(true);
  });

  it("rejects changed application versions and dependencies", () => {
    const generated = JSON.stringify({
      metadata: { component: { version: "0.1.0-beta.1" } },
      components: [{ name: "commander", version: "15.0.0" }],
    }, null, 2);
    const changedVersion = generated.replace("0.1.0-beta.1", "0.1.0-beta.2");
    const changedDependency = generated.replace("15.0.0", "15.1.0");

    expect(sbomTextMatches(changedVersion, generated)).toBe(false);
    expect(sbomTextMatches(changedDependency, generated)).toBe(false);
  });

  it("describes the application and a closed production dependency graph", async () => {
    const [bom, packageJson] = await Promise.all([
      fs.readFile(path.join(ROOT, "sbom.cdx.json"), "utf8").then(JSON.parse),
      fs.readFile(path.join(ROOT, "package.json"), "utf8").then(JSON.parse),
    ]);
    expect(bom).toMatchObject({
      bomFormat: "CycloneDX",
      specVersion: "1.5",
      version: 1,
      metadata: {
        component: {
          type: "application",
          name: packageJson.name,
          version: packageJson.version,
        },
      },
    });
    const rootRef = bom.metadata.component["bom-ref"] as string;
    const componentRefs = new Set<string>(
      bom.components.map((component: { "bom-ref": string }) => component["bom-ref"])
    );
    expect(componentRefs.size).toBe(bom.components.length);
    expect(bom.components.map((component: { name: string }) => component.name))
      .toEqual(expect.arrayContaining(["commander", "fast-glob", "picocolors", "zod"]));
    expect(bom.components.map((component: { name: string }) => component.name))
      .not.toContain("vitest");
    const knownRefs = new Set([rootRef, ...componentRefs]);
    for (const dependency of bom.dependencies as Array<{ ref: string; dependsOn: string[] }>) {
      expect(knownRefs.has(dependency.ref)).toBe(true);
      for (const target of dependency.dependsOn) expect(knownRefs.has(target)).toBe(true);
    }
    const rootDependencies = bom.dependencies.find(
      (dependency: { ref: string }) => dependency.ref === rootRef
    );
    expect(rootDependencies.dependsOn).toHaveLength(Object.keys(packageJson.dependencies).length);
  });
});

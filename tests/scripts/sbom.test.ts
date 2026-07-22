import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");

describe("CycloneDX SBOM", () => {
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

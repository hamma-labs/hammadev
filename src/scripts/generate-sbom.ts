import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const TARGET = path.join(ROOT, "sbom.cdx.json");

interface ListedDependency {
  version: string;
  path?: string;
  dependencies?: Record<string, ListedDependency>;
}

interface ListedProject extends ListedDependency {
  name: string;
}

interface Component {
  type: "library";
  name: string;
  version: string;
  purl: string;
  "bom-ref": string;
  licenses?: Array<{ license: { id: string } }>;
}

function purl(name: string, version: string): string {
  const encodedName = name.startsWith("@")
    ? `${encodeURIComponent(name.slice(0, name.indexOf("/")))}/${encodeURIComponent(name.slice(name.indexOf("/") + 1))}`
    : encodeURIComponent(name);
  return `pkg:npm/${encodedName}@${encodeURIComponent(version)}`;
}

async function packageLicense(target: string | undefined): Promise<string | undefined> {
  if (!target) return undefined;
  try {
    const manifest = JSON.parse(await fs.readFile(path.join(target, "package.json"), "utf8")) as {
      license?: unknown;
    };
    return typeof manifest.license === "string" && /^[A-Za-z0-9-.+]+$/.test(manifest.license)
      ? manifest.license
      : undefined;
  } catch {
    return undefined;
  }
}

async function generate(): Promise<string> {
  const packageJson = JSON.parse(await fs.readFile(path.join(ROOT, "package.json"), "utf8")) as {
    name: string;
    version: string;
    license?: string;
  };
  const pnpmCli = process.env.npm_execpath;
  if (!pnpmCli) throw new Error("security:sbom must run through pnpm so npm_execpath is available.");
  const listed = JSON.parse(execFileSync(
    process.execPath,
    [pnpmCli, "list", "--prod", "--json", "--depth", "Infinity"],
    { cwd: ROOT, encoding: "utf8", maxBuffer: 8 * 1024 * 1024 }
  )) as ListedProject[];
  const project = listed[0];
  if (!project || project.name !== packageJson.name || project.version !== packageJson.version) {
    throw new Error("pnpm production dependency tree does not match package.json.");
  }

  const components = new Map<string, Component>();
  const dependencyEdges = new Map<string, Set<string>>();
  const visit = async (dependencies: Record<string, ListedDependency> = {}): Promise<string[]> => {
    const refs: string[] = [];
    for (const [name, dependency] of Object.entries(dependencies).sort(([left], [right]) =>
      left.localeCompare(right)
    )) {
      const ref = purl(name, dependency.version);
      refs.push(ref);
      if (!components.has(ref)) {
        const license = await packageLicense(dependency.path);
        components.set(ref, {
          type: "library",
          name,
          version: dependency.version,
          purl: ref,
          "bom-ref": ref,
          ...(license ? { licenses: [{ license: { id: license } }] } : {}),
        });
      }
      const children = await visit(dependency.dependencies);
      const edges = dependencyEdges.get(ref) ?? new Set<string>();
      children.forEach((child) => edges.add(child));
      dependencyEdges.set(ref, edges);
    }
    return refs;
  };

  const rootRef = purl(packageJson.name, packageJson.version);
  const directDependencies = await visit(project.dependencies);
  dependencyEdges.set(rootRef, new Set(directDependencies));
  const bom = {
    bomFormat: "CycloneDX",
    specVersion: "1.5",
    version: 1,
    metadata: {
      tools: [{ vendor: "HammaDev", name: "generate-sbom", version: "1" }],
      component: {
        type: "application",
        name: packageJson.name,
        version: packageJson.version,
        purl: rootRef,
        "bom-ref": rootRef,
        ...(packageJson.license
          ? { licenses: [{ license: { id: packageJson.license } }] }
          : {}),
      },
    },
    components: [...components.values()].sort((left, right) =>
      left["bom-ref"].localeCompare(right["bom-ref"])
    ),
    dependencies: [...dependencyEdges.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([ref, dependsOn]) => ({ ref, dependsOn: [...dependsOn].sort() })),
  };
  return `${JSON.stringify(bom, null, 2)}\n`;
}

async function main(): Promise<void> {
  const generated = await generate();
  if (process.argv.includes("--check")) {
    let existing: string;
    try {
      existing = await fs.readFile(TARGET, "utf8");
    } catch (error: any) {
      if (error.code === "ENOENT") {
        throw new Error("sbom.cdx.json is missing; run pnpm security:sbom.");
      }
      throw error;
    }
    if (existing !== generated) {
      throw new Error("sbom.cdx.json is stale; run pnpm security:sbom and commit the result.");
    }
    process.stdout.write("sbom.cdx.json matches the installed production dependency tree.\n");
    return;
  }
  await fs.writeFile(TARGET, generated, "utf8");
  process.stdout.write(`Wrote ${TARGET}.\n`);
}

main().catch((error: unknown) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});

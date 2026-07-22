import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { resolveNpmCli } from "../../src/scripts/npm-cli.js";

const temporaryRoots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-npm-cli-test-"));
  temporaryRoots.push(root);
  return root;
}

async function touch(target: string): Promise<void> {
  await fs.mkdir(path.dirname(target), { recursive: true });
  await fs.writeFile(target, "#!/usr/bin/env node\n", "utf8");
}

afterEach(async () => {
  await Promise.all(
    temporaryRoots.splice(0).map((root) =>
      fs.rm(root, { recursive: true, force: true })
    )
  );
});

describe("npm CLI resolution", () => {
  it("honors an explicit npm CLI path", async () => {
    const root = await temporaryRoot();
    const configured = path.join(root, "custom", "npm-cli.js");
    await touch(configured);

    await expect(resolveNpmCli(path.join(root, "bin", "node"), {
      NPM_CLI_JS: configured,
    })).resolves.toBe(configured);
  });

  it("rejects a working-directory-dependent npm override", async () => {
    const root = await temporaryRoot();

    await expect(resolveNpmCli(path.join(root, "bin", "node"), {
      NPM_CLI_JS: "relative/npm-cli.js",
    })).rejects.toThrow(/must be an absolute path/);
  });

  it("finds npm beside node as installed on Windows runners", async () => {
    const root = await temporaryRoot();
    const nodeExecutable = path.join(root, "node.exe");
    const npmCli = path.join(root, "node_modules", "npm", "bin", "npm-cli.js");
    await touch(npmCli);

    await expect(resolveNpmCli(nodeExecutable, {
      npm_execpath: path.join(root, "pnpm.cjs"),
    })).resolves.toBe(npmCli);
  });

  it("finds npm in the Unix lib layout", async () => {
    const root = await temporaryRoot();
    const nodeExecutable = path.join(root, "bin", "node");
    const npmCli = path.join(root, "lib", "node_modules", "npm", "bin", "npm-cli.js");
    await touch(npmCli);

    await expect(resolveNpmCli(nodeExecutable, {})).resolves.toBe(npmCli);
  });

  it("fails with an actionable override when npm cannot be located", async () => {
    const root = await temporaryRoot();

    await expect(resolveNpmCli(path.join(root, "bin", "node"), {}))
      .rejects.toThrow(/Set NPM_CLI_JS/);
  });
});

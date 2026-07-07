import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import {
  MAX_SESSION_BYTES,
  resolveSessionTarget
} from "../src/session-loader.js";

const SESSION_ID = "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa";
const roots: string[] = [];

async function temporaryRoot(): Promise<string> {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-loader-security-"));
  roots.push(root);
  return root;
}

afterEach(async () => {
  await Promise.all(
    roots.splice(0).map((root) => fs.rm(root, { recursive: true, force: true }))
  );
});

describe("session loader boundaries", () => {
  it("rejects parent-directory traversal before resolution", async () => {
    const root = await temporaryRoot();
    const claudeHome = path.join(root, "claude");
    const target = `${claudeHome}/projects/../${SESSION_ID}.jsonl`;

    await expect(
      resolveSessionTarget(target, { claudeHomes: [claudeHome] })
    ).rejects.toThrow("parent-directory traversal");
  });

  it("rejects a direct session outside configured roots", async () => {
    const root = await temporaryRoot();
    const claudeHome = path.join(root, "claude");
    const outside = path.join(root, "outside", `${SESSION_ID}.jsonl`);
    await fs.mkdir(path.dirname(outside), { recursive: true });
    await fs.writeFile(outside, "{}\n");

    await expect(
      resolveSessionTarget(outside, { claudeHomes: [claudeHome] })
    ).rejects.toThrow("outside the allowed session directories");
  });

  it("rejects symlinks that escape a configured root", async () => {
    const root = await temporaryRoot();
    const claudeHome = path.join(root, "claude");
    const outside = path.join(root, "outside.jsonl");
    const linked = path.join(claudeHome, "projects", `${SESSION_ID}.jsonl`);
    await fs.mkdir(path.dirname(linked), { recursive: true });
    await fs.writeFile(outside, "{}\n");
    await fs.symlink(outside, linked);

    await expect(
      resolveSessionTarget(linked, { claudeHomes: [claudeHome] })
    ).rejects.toThrow("resolves outside");
  });

  it("rejects oversized sessions before parsing", async () => {
    const root = await temporaryRoot();
    const claudeHome = path.join(root, "claude");
    const target = path.join(claudeHome, "projects", `${SESSION_ID}.jsonl`);
    await fs.mkdir(path.dirname(target), { recursive: true });
    await fs.writeFile(target, "");
    await fs.truncate(target, MAX_SESSION_BYTES + 1);

    await expect(
      resolveSessionTarget(target, { claudeHomes: [claudeHome] })
    ).rejects.toThrow("exceeds the 50 MiB limit");
  });
});

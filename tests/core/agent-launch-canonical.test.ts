import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  discardAgentLaunch,
  listAgentLaunches,
  prepareAgentLaunch,
  registerAgentSessionStart,
} from "../../src/core/agent-launch.js";
import { startMemory } from "../../src/core/memory.js";

describe("agent launch canonical project paths", () => {
  it("binds the same launch through lexical and canonical ancestor paths", async () => {
    const root = await fs.mkdtemp(path.join(os.tmpdir(), "hamma-launch-ancestor-"));
    const realParent = path.join(root, "real-parent");
    const realProject = path.join(realParent, "project");
    const aliasParent = path.join(root, "alias-parent");
    try {
      await fs.mkdir(realProject, { recursive: true });
      await fs.symlink(realParent, aliasParent);
      const aliasProject = path.join(aliasParent, "project");
      const canonicalProject = await fs.realpath(realProject);
      await startMemory(aliasProject, "default", undefined, false);

      const prepared = await prepareAgentLaunch("codex", aliasProject, {
        wrapperPid: 2_147_483_647,
      });
      expect(prepared.launch?.projectPath).toBe(canonicalProject);
      const launchId = prepared.launch!.id;

      await expect(registerAgentSessionStart(
        "codex",
        canonicalProject,
        { session_id: "canonical-session" },
        launchId
      )).resolves.toMatchObject({
        status: "registered",
        sessionId: "canonical-session",
      });
      await expect(listAgentLaunches("codex", aliasProject))
        .resolves.toEqual([
          expect.objectContaining({ id: launchId, projectPath: canonicalProject }),
        ]);

      await discardAgentLaunch("codex", canonicalProject, launchId);
    } finally {
      await fs.rm(root, { recursive: true, force: true });
    }
  });
});

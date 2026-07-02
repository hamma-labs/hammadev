import { discoverCodexSessions } from "./discover.js";
import { parseCodexRollout } from "./rollout.js";

export const CodexAdapter = {
  async list() {
    return discoverCodexSessions();
  },

  async latest() {
    const sessions = await discoverCodexSessions();
    return sessions[0] ?? null;
  },

  async inspect(sessionPath: string) {
    return parseCodexRollout(sessionPath);
  }
};

export type SourceCli = "codex" | "claude" | "grok" | "gemini" | "antigravity" | "opencode";

export interface HammaSessionMeta {
  sourceCli: SourceCli;
  sourceSessionId: string;
  projectPath?: string;
  title?: string;
  startedAt?: string;
  lastUpdatedAt?: string;
  sourcePath?: string;
}

export interface HammaMessage {
  role: "user" | "assistant" | "system";
  content: string;
  timestamp?: string;
}

export interface HammaShellCommand {
  command: string;
  output?: string;
  exitCode?: number;
  startedAt?: string;
  endedAt?: string;
}

export interface HammaSession {
  meta: HammaSessionMeta;
  messages: HammaMessage[];
  shellCommands: HammaShellCommand[];
  parserWarnings: string[];
  security: {
    redacted: boolean;
    redactionCount: number;
    warnings: string[];
  };
  /** Optional source-supplied extraction hints (e.g. tuned regexes for this agent's phrasing style).
   *  Kept in adapter; consumed by extractTaskState. See AC for hybrid.
   */
  extractionHints?: {
    completedPatterns?: RegExp[];
    remainingPatterns?: RegExp[];
  };
}

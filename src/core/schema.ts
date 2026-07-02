export type SourceCli = "codex" | "claude" | "gemini" | "antigravity" | "opencode";

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
}

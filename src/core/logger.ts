import { randomUUID } from "node:crypto";
import { Writable } from "node:stream";

export type LogLevel = "off" | "error" | "warn" | "info" | "debug";

export interface LoggerOptions {
  level?: string;
  operation?: string;
  traceId?: string;
  stream?: Writable;
}

const LEVEL_PRIORITY: Record<LogLevel, number> = {
  off: 0,
  error: 1,
  warn: 2,
  info: 3,
  debug: 4
};

export function parseLogLevel(value: string | undefined): LogLevel {
  const normalized = value?.toLowerCase() ?? "off";
  if (normalized in LEVEL_PRIORITY) return normalized as LogLevel;
  throw new Error(
    `Invalid log level '${value}'. Use off, error, warn, info, or debug.`
  );
}

export class AsyncStructuredLogger {
  readonly traceId: string;
  private level: LogLevel;
  private operation: string;
  private readonly stream: Writable;
  private buffer: string[] = [];
  private scheduled = false;
  private waiters: Array<() => void> = [];

  constructor(options: LoggerOptions = {}) {
    this.level = parseLogLevel(options.level ?? process.env.HAMMA_LOG_LEVEL);
    this.operation = options.operation ?? "cli";
    this.traceId = options.traceId ?? randomUUID();
    this.stream = options.stream ?? process.stderr;
  }

  setLevel(level: string | undefined): void {
    this.level = parseLogLevel(level);
  }

  setOperation(operation: string): void {
    this.operation = operation;
  }

  error(event: string, context: Record<string, unknown> = {}): void {
    this.log("error", event, context);
  }

  warn(event: string, context: Record<string, unknown> = {}): void {
    this.log("warn", event, context);
  }

  info(event: string, context: Record<string, unknown> = {}): void {
    this.log("info", event, context);
  }

  debug(event: string, context: Record<string, unknown> = {}): void {
    this.log("debug", event, context);
  }

  flush(): Promise<void> {
    if (this.buffer.length === 0 && !this.scheduled) return Promise.resolve();
    return new Promise((resolve) => {
      this.waiters.push(resolve);
      if (!this.scheduled) this.scheduleFlush();
    });
  }

  private log(
    level: Exclude<LogLevel, "off">,
    event: string,
    context: Record<string, unknown>
  ): void {
    if (LEVEL_PRIORITY[level] > LEVEL_PRIORITY[this.level]) return;
    this.buffer.push(
      JSON.stringify({
        timestamp: new Date().toISOString(),
        level,
        traceId: this.traceId,
        operation: this.operation,
        event,
        context
      }) + "\n"
    );
    this.scheduleFlush();
  }

  private scheduleFlush(): void {
    if (this.scheduled) return;
    this.scheduled = true;
    setImmediate(() => this.drain());
  }

  private drain(): void {
    const payload = this.buffer.join("");
    this.buffer = [];
    if (!payload) {
      this.finishFlush();
      return;
    }

    this.stream.write(payload, () => {
      if (this.buffer.length > 0) setImmediate(() => this.drain());
      else this.finishFlush();
    });
  }

  private finishFlush(): void {
    this.scheduled = false;
    const waiters = this.waiters;
    this.waiters = [];
    for (const resolve of waiters) resolve();
  }
}

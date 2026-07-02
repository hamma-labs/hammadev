import { describe, expect, it } from "vitest";
import { redactText } from "../../src/core/redact.js";

describe("redactText", () => {
  it("redacts an OpenAI-like secret key", async () => {
    const input = "OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwxyz012345";
    const { text, count } = redactText(input);
    expect(text).not.toContain("sk-abcdefghijklmnopqrstuvwxyz012345");
    expect(text).toContain("[REDACTED_SECRET]");
    expect(count).toBeGreaterThan(0);
  });

  it("redacts an Anthropic-like secret key", async () => {
    const input = "use sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890 here";
    const { text, count } = redactText(input);
    expect(text).not.toContain("sk-ant-api03-ABCDEFGHIJKLMNOPQRSTUVWXYZ1234567890");
    expect(text).toContain("[REDACTED_SECRET]");
    expect(count).toBeGreaterThan(0);
  });

  it("redacts a GitHub personal-access-token-like value", async () => {
    const input = "token: ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
    const { text, count } = redactText(input);
    expect(text).not.toContain("ghp_ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789");
    expect(text).toContain("[REDACTED_SECRET]");
    expect(count).toBeGreaterThan(0);
  });

  it("redacts a generic api_key= assignment", async () => {
    const input = 'config.api_key = "totally-not-a-real-key-1234567890"';
    const { text, count } = redactText(input);
    expect(text).not.toContain("totally-not-a-real-key-1234567890");
    expect(text).toContain("[REDACTED_SECRET]");
    expect(count).toBeGreaterThan(0);
  });

  it("does not redact benign text", async () => {
    const input = "just a normal sentence with no secrets in it";
    const { text, count } = redactText(input);
    expect(text).toBe(input);
    expect(count).toBe(0);
  });
});

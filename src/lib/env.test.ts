import { describe, expect, it } from "vitest";
import { parseServerEnv } from "./env";

const DEFAULT_SECRET = "better-auth-secret-12345678901234567890";
const GOOD_SECRET = "a".repeat(64);
const GOOD_URL = "https://sidetrack.example.com";
const PROD = { nodeEnv: "production", nextPhase: undefined };

describe("parseServerEnv", () => {
  it("accepts a fully-configured production environment", () => {
    const env = parseServerEnv(
      { BETTER_AUTH_SECRET: GOOD_SECRET, BETTER_AUTH_URL: GOOD_URL },
      PROD,
    );
    expect(env.BETTER_AUTH_SECRET).toBe(GOOD_SECRET);
    expect(env.BETTER_AUTH_URL).toBe(GOOD_URL);
  });

  it("throws in production when BETTER_AUTH_URL is missing", () => {
    expect(() =>
      parseServerEnv({ BETTER_AUTH_SECRET: GOOD_SECRET }, PROD),
    ).toThrow(/BETTER_AUTH_URL is not set/);
  });

  it("throws in production when BETTER_AUTH_SECRET is missing or default", () => {
    expect(() =>
      parseServerEnv({ BETTER_AUTH_URL: GOOD_URL }, PROD),
    ).toThrow(/BETTER_AUTH_SECRET is missing/);
    expect(() =>
      parseServerEnv(
        { BETTER_AUTH_SECRET: DEFAULT_SECRET, BETTER_AUTH_URL: GOOD_URL },
        PROD,
      ),
    ).toThrow(/BETTER_AUTH_SECRET is missing/);
  });

  it("aggregates multiple problems into one error", () => {
    let message = "";
    try {
      parseServerEnv({}, PROD);
    } catch (e) {
      message = (e as Error).message;
    }
    expect(message).toMatch(/BETTER_AUTH_SECRET is missing/);
    expect(message).toMatch(/BETTER_AUTH_URL is not set/);
  });

  it("rejects a malformed BETTER_AUTH_URL even in development", () => {
    expect(() =>
      parseServerEnv(
        { BETTER_AUTH_URL: "not-a-url" },
        { nodeEnv: "development", nextPhase: undefined },
      ),
    ).toThrow(/absolute http\(s\) URL/);
  });

  it("does not enforce required vars during `next build`", () => {
    expect(() =>
      parseServerEnv({}, {
        nodeEnv: "production",
        nextPhase: "phase-production-build",
      }),
    ).not.toThrow();
  });

  it("does not enforce required vars in development (zero-config)", () => {
    expect(() =>
      parseServerEnv({}, { nodeEnv: "development", nextPhase: undefined }),
    ).not.toThrow();
  });

  it("requires EMAIL_FROM whenever RESEND_API_KEY is set, in any mode", () => {
    expect(() =>
      parseServerEnv(
        { RESEND_API_KEY: "re_123" },
        { nodeEnv: "development", nextPhase: undefined },
      ),
    ).toThrow(/EMAIL_FROM is required/);

    const env = parseServerEnv(
      {
        BETTER_AUTH_SECRET: GOOD_SECRET,
        BETTER_AUTH_URL: GOOD_URL,
        RESEND_API_KEY: "re_123",
        EMAIL_FROM: "Sidetrack <no-reply@sidetrack.it>",
      },
      PROD,
    );
    expect(env.RESEND_API_KEY).toBe("re_123");
    expect(env.EMAIL_FROM).toBe("Sidetrack <no-reply@sidetrack.it>");
  });

  it("treats email vars as optional (console fallback)", () => {
    const env = parseServerEnv(
      { BETTER_AUTH_SECRET: GOOD_SECRET, BETTER_AUTH_URL: GOOD_URL },
      PROD,
    );
    expect(env.RESEND_API_KEY).toBeUndefined();
    expect(env.EMAIL_FROM).toBeUndefined();
  });

  it("normalizes ALLOW_SIGNUP and applies path defaults", () => {
    const off = parseServerEnv({}, { nodeEnv: "test", nextPhase: undefined });
    expect(off.ALLOW_SIGNUP).toBe(false);
    expect(off.DB_PATH).toBe("./data/sidetrack.db");
    expect(off.BACKUP_DIR).toBe("./data/backups");

    const on = parseServerEnv(
      { ALLOW_SIGNUP: "true", DB_PATH: "/data/s.db", BACKUP_DIR: "/data/b" },
      { nodeEnv: "test", nextPhase: undefined },
    );
    expect(on.ALLOW_SIGNUP).toBe(true);
    expect(on.DB_PATH).toBe("/data/s.db");
    expect(on.BACKUP_DIR).toBe("/data/b");
  });
});

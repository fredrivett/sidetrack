import { describe, expect, it } from "vitest";
import { assertAuthSecret } from "./assert-auth-secret";

const DEFAULT_SECRET = "better-auth-secret-12345678901234567890";
const GOOD_SECRET = "a".repeat(64);

describe("assertAuthSecret", () => {
  it("throws in production when the secret is unset", () => {
    expect(() =>
      assertAuthSecret({
        secret: undefined,
        nodeEnv: "production",
        nextPhase: undefined,
      }),
    ).toThrow(/BETTER_AUTH_SECRET is not set/);
  });

  it("throws in production when the secret is empty", () => {
    expect(() =>
      assertAuthSecret({
        secret: "",
        nodeEnv: "production",
        nextPhase: undefined,
      }),
    ).toThrow(/BETTER_AUTH_SECRET is not set/);
  });

  it("throws in production when the secret is left at Better Auth's default", () => {
    expect(() =>
      assertAuthSecret({
        secret: DEFAULT_SECRET,
        nodeEnv: "production",
        nextPhase: undefined,
      }),
    ).toThrow(/BETTER_AUTH_SECRET is not set/);
  });

  it("passes in production with a real secret", () => {
    expect(() =>
      assertAuthSecret({
        secret: GOOD_SECRET,
        nodeEnv: "production",
        nextPhase: undefined,
      }),
    ).not.toThrow();
  });

  it("does not throw during `next build`, even with no secret", () => {
    expect(() =>
      assertAuthSecret({
        secret: undefined,
        nodeEnv: "production",
        nextPhase: "phase-production-build",
      }),
    ).not.toThrow();
  });

  it("does not throw in development with no secret (zero-config dev)", () => {
    expect(() =>
      assertAuthSecret({
        secret: undefined,
        nodeEnv: "development",
        nextPhase: undefined,
      }),
    ).not.toThrow();
  });

  it("does not throw in test with no secret", () => {
    expect(() =>
      assertAuthSecret({
        secret: undefined,
        nodeEnv: "test",
        nextPhase: undefined,
      }),
    ).not.toThrow();
  });
});

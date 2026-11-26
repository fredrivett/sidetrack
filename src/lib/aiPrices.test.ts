import { describe, expect, it } from "vitest";
import { AI_MODELS, CALLED_MODELS, feedPrice, priceOn } from "./aiPrices";

describe("aiPrices", () => {
  it("prices every model the code calls, and checks it against at least one list", () => {
    for (const model of CALLED_MODELS) {
      expect(priceOn(model, "2026-10-07"), model).not.toBeNull();
      expect(Object.keys(AI_MODELS[model].feeds).length, model).toBeGreaterThan(0);
    }
  });

  it("reads LiteLLM's per-token prices as per million, without float dust", () => {
    const list = { "typesafe/jev-latest": { input_cost_per_token: 4.2e-8, output_cost_per_token: 0 } };
    expect(feedPrice("liteLLM", list, "typesafe/jev-latest")).toEqual({ input: 0.042, output: 0, cacheRead: 0, cacheWrite: 0 });
  });

  it("finds a models.dev price by provider and model", () => {
    const list = { anthropic: { models: { "claude-haiku-5-5": { cost: { input: 0.1, output: 0.5, cache_read: 0.01 } } } } };
    expect(feedPrice("modelsDev", list, "anthropic/claude-haiku-5-5")).toEqual({ input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0 });
    expect(feedPrice("modelsDev", list, "anthropic/claude-sonnet-5-5")).toBeNull();
  });
});

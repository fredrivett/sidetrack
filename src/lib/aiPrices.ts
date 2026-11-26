// What the AI models Sidetrack calls cost, and how to tell when that changes.
// Framework-agnostic: core/aiUsage.ts keeps the prices the daily check finds
// and works out spend from them.
//
// Each model's prices here are where it starts; core adds a dated price
// whenever the published price feeds agree it's changed, so these only need
// editing to add a model. A model the code calls but this doesn't list fails
// aiPrices.test.ts, so it can't go unpriced.

import { GREETING_MODEL, WRITER_MODEL } from "./greetingWriter";
import { JEV_MODEL } from "./jev";

/** USD per million tokens. */
export interface Price {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export interface DatedPrice extends Price {
  /** The UTC day (YYYY-MM-DD) it applies from. */
  from: string;
}

export interface Tokens {
  input: number;
  output: number;
  cacheRead: number;
  cacheWrite: number;
}

export type PriceFeed = "modelsDev" | "liteLLM";

/** Each feed's whole price list, fetched once a day. */
export const PRICE_FEED_URLS: Record<PriceFeed, string> = {
  modelsDev: "https://models.dev/api.json",
  liteLLM: "https://raw.githubusercontent.com/BerriAI/litellm/main/model_prices_and_context_window.json",
};

export const PRICE_FEED_NAMES: Record<PriceFeed, string> = { modelsDev: "models.dev", liteLLM: "LiteLLM" };

interface Model {
  /** The model's key in each feed that lists it; a new price needs all of them to agree. */
  feeds: Partial<Record<PriceFeed, string>>;
  prices: DatedPrice[];
}

// Each price from the day it took effect. Haiku 5.5 costs five times as much for a prompt over 100k tokens; ours
// are a few thousand at most, so only its usual price is kept.
export const AI_MODELS: Record<string, Model> = {
  "claude-sonnet-5-5": {
    feeds: { modelsDev: "anthropic/claude-sonnet-5-5", liteLLM: "claude-sonnet-5-5" },
    prices: [
      // Released 2026-09-28; cache reads halved when Haiku 5.5 came out.
      { from: "2026-09-28", input: 2, output: 10, cacheRead: 0.2, cacheWrite: 2.5 },
      { from: "2026-10-07", input: 2, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
    ],
  },
  "claude-haiku-5-5": {
    feeds: { modelsDev: "anthropic/claude-haiku-5-5", liteLLM: "claude-haiku-5-5" },
    prices: [{ from: "2026-10-07", input: 0.1, output: 0.5, cacheRead: 0.01, cacheWrite: 0.125 }],
  },
  // Jev bills input only. models.dev doesn't list it, so LiteLLM alone says.
  // Its price as of 2026-09, when abode's table checked it.
  [JEV_MODEL]: {
    feeds: { liteLLM: "typesafe/jev-latest" },
    prices: [{ from: "2026-09-01", input: 0.042, output: 0, cacheRead: 0, cacheWrite: 0 }],
  },
};

/** The models the code calls, for the test that each is priced. */
export const CALLED_MODELS = [GREETING_MODEL, WRITER_MODEL, JEV_MODEL];

/**
 * The price of `model` on `day`: the latest of the ones in code and `found`
 * (from the daily check) that applies by then. Null when it has none.
 */
export function priceOn(model: string, day: string, found: DatedPrice[] = []): DatedPrice | null {
  let best: DatedPrice | null = null;
  for (const p of [...(AI_MODELS[model]?.prices ?? []), ...found]) {
    if (p.from <= day && (!best || p.from >= best.from)) best = p;
  }
  return best;
}

/** What `tokens` cost at `price`, in USD. */
export function costOf(tokens: Tokens, price: Price): number {
  return (
    (tokens.input * price.input +
      tokens.output * price.output +
      tokens.cacheRead * price.cacheRead +
      tokens.cacheWrite * price.cacheWrite) /
    1_000_000
  );
}

// Per million tokens, to a millionth of a dollar: per-token feeds come out
// as 0.042000000000000003.
const round = (n: number) => Math.round(n * 1_000_000) / 1_000_000;

function num(v: unknown): number | null {
  const n = typeof v === "string" ? Number(v) : v;
  return typeof n === "number" && Number.isFinite(n) && n >= 0 ? n : null;
}

/**
 * A model's price in one feed's list, or null when it isn't there or
 * doesn't say what input and output cost. A cache price it leaves out is 0:
 * calls that don't cache have no such tokens.
 */
export function feedPrice(feed: PriceFeed, list: unknown, key: string): Price | null {
  if (feed === "modelsDev") {
    // Keyed provider, then model: "anthropic/claude-sonnet-5-5".
    const [provider, ...rest] = key.split("/");
    const cost = (list as Record<string, { models?: Record<string, { cost?: Record<string, unknown> }> }>)?.[
      provider
    ]?.models?.[rest.join("/")]?.cost;
    const input = num(cost?.input);
    const output = num(cost?.output);
    if (input === null || output === null) return null;
    return { input, output, cacheRead: num(cost?.cache_read) ?? 0, cacheWrite: num(cost?.cache_write) ?? 0 };
  }
  // LiteLLM: USD per token.
  const entry = (list as Record<string, Record<string, unknown>>)?.[key];
  const input = num(entry?.input_cost_per_token);
  const output = num(entry?.output_cost_per_token);
  if (input === null || output === null) return null;
  const perMillion = (v: unknown) => round((num(v) ?? 0) * 1_000_000);
  return {
    input: perMillion(input),
    output: perMillion(output),
    cacheRead: perMillion(entry?.cache_read_input_token_cost),
    cacheWrite: perMillion(entry?.cache_creation_input_token_cost),
  };
}

const FIELDS = ["input", "output", "cacheRead", "cacheWrite"] as const;
const same = (a: Price, b: Price) => FIELDS.every((f) => round(a[f]) === round(b[f]));

/**
 * What the feeds say about `model`'s price, against `current`: unchanged, a
 * new price to apply, or why it can't be trusted (and `current` stays).
 * `lists` holds each feed's list, or null when it couldn't be read. A new
 * price needs every feed that should list the model to list the same one,
 * no more than 10 times up or down from `current`, so one feed's mistake
 * or a misplaced decimal point never reaches the dashboard.
 */
export function reviewPrice(
  model: string,
  current: Price,
  lists: Partial<Record<PriceFeed, unknown | null>>,
): { unchanged: true } | { price: Price } | { unconfirmed: string } {
  const found: Price[] = [];
  for (const [feed, key] of Object.entries(AI_MODELS[model]?.feeds ?? {}) as [PriceFeed, string][]) {
    const list = lists[feed];
    if (list == null) return { unconfirmed: `Couldn't read ${PRICE_FEED_NAMES[feed]}` };
    const price = feedPrice(feed, list, key);
    if (!price) return { unconfirmed: `${PRICE_FEED_NAMES[feed]} no longer lists it` };
    found.push(price);
  }
  const [price, ...others] = found;
  if (!price) return { unconfirmed: "No price list covers it" };
  if (others.some((p) => !same(p, price))) return { unconfirmed: "The price lists disagree" };
  if (same(price, current)) return { unchanged: true };
  const jump = FIELDS.some((f) => current[f] > 0 && price[f] > 0 && Math.max(current[f] / price[f], price[f] / current[f]) > 10);
  if (jump || FIELDS.some((f) => current[f] > 0 && price[f] === 0)) {
    return { unconfirmed: "The lists' new price is too far from the last one" };
  }
  return { price: Object.fromEntries(FIELDS.map((f) => [f, round(price[f])])) as unknown as Price };
}

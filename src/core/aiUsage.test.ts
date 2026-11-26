import { describe, expect, it } from "vitest";
import { AI_MODELS, PRICE_FEED_URLS } from "../lib/aiPrices";
import { aiFetch, aiSpend, checkAiPrices, recordAiUsage } from "./aiUsage";
import { aiPrices } from "./schema";
import { createTestDb, createTestUser } from "./test-helpers";

const SONNET = "claude-sonnet-5-5";
const DAY = Date.parse("2026-12-01T12:00:00Z");

function reply(body: unknown, status = 200): typeof fetch {
  return async () => new Response(JSON.stringify(body), { status });
}

describe("aiFetch", () => {
  it("adds each call's tokens to the person's row for the feature and model", async () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const body = {
      content: [{ type: "text", text: "hi" }],
      usage: { input_tokens: 1200, output_tokens: 80, cache_read_input_tokens: 300, cache_creation_input_tokens: 7 },
    };
    const f = aiFetch(db, u, "dayTags", reply(body));
    const send = () => f("https://api.anthropic.com/v1/messages", { method: "POST", body: JSON.stringify({ model: SONNET }) });
    // The caller still reads the whole reply.
    expect(await (await send()).json()).toEqual(body);
    await send();

    const spend = aiSpend(db, "2000-01-01");
    expect(spend.total).toMatchObject({ calls: 2, tokens: 2 * (1200 + 80 + 300 + 7) });
    // 2 × (1200 × $2 + 80 × $10 + 300 × $0.10 + 7 × $2.50) per million.
    expect(spend.byUser.get(u)?.cost).toBeCloseTo((2 * (2400 + 800 + 30 + 17.5)) / 1e6, 12);
    expect([...spend.byFeature.keys()]).toEqual(["dayTags"]);
  });

  it("counts nothing for a failed call or a reply without usage", async () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const init = { method: "POST", body: JSON.stringify({ model: SONNET }) };
    const failed = await aiFetch(db, u, "newItem", reply({ usage: { input_tokens: 5 } }, 429))("x", init);
    expect(failed.status).toBe(429);
    await aiFetch(db, u, "newItem", reply({ answers: {} }))("x", init);
    expect(aiSpend(db, "2000-01-01").total.calls).toBe(0);
  });
});

describe("aiSpend", () => {
  it("prices each day's tokens at the price that day, so a new price doesn't change earlier days", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    const tokens = { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 };
    recordAiUsage(db, u, "greeting", SONNET, tokens, Date.parse("2026-12-01T10:00:00Z"));
    recordAiUsage(db, u, "greeting", SONNET, tokens, Date.parse("2026-12-03T10:00:00Z"));
    db.insert(aiPrices).values({ model: SONNET, from: "2026-12-02", input: 3, output: 15, cacheRead: 0.3, cacheWrite: 3.75 }).run();

    const spend = aiSpend(db, "2026-12-01");
    expect(spend.byDay.get("2026-12-01")?.cost).toBeCloseTo(2);
    expect(spend.byDay.get("2026-12-03")?.cost).toBeCloseTo(3);
    expect(aiSpend(db, "2026-12-02").total.cost).toBeCloseTo(3);
  });

  it("names a model it has no price for, and counts it as free", () => {
    const { db } = createTestDb();
    const u = createTestUser(db);
    recordAiUsage(db, u, "greeting", "claude-unknown", { input: 10, output: 10, cacheRead: 0, cacheWrite: 0 });
    expect(aiSpend(db, "2000-01-01")).toMatchObject({ unpriced: ["claude-unknown"], total: { cost: 0, calls: 1 } });
  });
});

describe("checkAiPrices", () => {
  /** Both feeds' lists, with Sonnet at `models` (models.dev) and `lite` (LiteLLM) per million. */
  function feeds(models: number | null, lite: number | null, down: "modelsDev" | null = null): typeof fetch {
    const modelsDev = {
      anthropic: {
        models: Object.fromEntries(
          Object.entries(AI_MODELS)
            .filter(([, m]) => m.feeds.modelsDev)
            .map(([id, m]) => {
              const p = m.prices[m.prices.length - 1];
              const input = id === SONNET ? models : p.input;
              return [id, input === null ? {} : { cost: { input, output: p.output, cache_read: p.cacheRead, cache_write: p.cacheWrite } }];
            }),
        ),
      },
    };
    const liteLLM = Object.fromEntries(
      Object.values(AI_MODELS).map((m) => {
        const p = m.prices[m.prices.length - 1];
        const id = m.feeds.liteLLM ?? "";
        const input = id === SONNET ? lite : p.input;
        return [
          id,
          input === null
            ? {}
            : {
                input_cost_per_token: input / 1e6,
                output_cost_per_token: p.output / 1e6,
                cache_read_input_token_cost: p.cacheRead / 1e6,
                cache_creation_input_token_cost: p.cacheWrite / 1e6,
              },
        ];
      }),
    );
    return async (url) => {
      if (url === PRICE_FEED_URLS.modelsDev) return down === "modelsDev" ? new Response("", { status: 503 }) : Response.json(modelsDev);
      return Response.json(liteLLM);
    };
  }

  const sonnetToday = (db: ReturnType<typeof createTestDb>["db"]) => {
    const u = createTestUser(db);
    recordAiUsage(db, u, "greeting", SONNET, { input: 1_000_000, output: 0, cacheRead: 0, cacheWrite: 0 }, DAY);
    return aiSpend(db, "2026-12-01");
  };

  it("leaves prices alone when the lists agree with them", async () => {
    const { db } = createTestDb();
    await checkAiPrices(db, feeds(2, 2), DAY);
    expect(db.select().from(aiPrices).all()).toEqual([]);
    expect(sonnetToday(db)).toMatchObject({ unconfirmed: {}, total: { cost: 2 } });
  });

  it("adds a new price from today when both lists agree on it", async () => {
    const { db } = createTestDb();
    await checkAiPrices(db, feeds(2.5, 2.5), DAY);
    expect(db.select().from(aiPrices).all()).toEqual([
      { model: SONNET, from: "2026-12-01", input: 2.5, output: 10, cacheRead: 0.1, cacheWrite: 2.5 },
    ]);
    expect(sonnetToday(db).total.cost).toBeCloseTo(2.5);
  });

  it("tries again within the day when it couldn't read either list", async () => {
    const { db } = createTestDb();
    await checkAiPrices(db, async () => new Response("", { status: 503 }), DAY);
    expect(aiSpend(db, "2026-12-01").checkedAt).toBeNull();
    await checkAiPrices(db, feeds(2, 2), DAY);
    expect(aiSpend(db, "2026-12-01")).toMatchObject({ checkedAt: DAY, unconfirmed: {} });
  });

  it.each([
    ["the lists disagree", feeds(2.5, 3), "The price lists disagree"],
    ["a list is down", feeds(2.5, 2.5, "modelsDev"), "Couldn't read models.dev"],
    ["a list drops the model", feeds(null, 2.5), "models.dev no longer lists it"],
    ["the new price is over 10× the last", feeds(25, 25), "The lists' new price is too far from the last one"],
  ])("keeps the last price, noted as unconfirmed, when %s", async (_, f, why) => {
    const { db } = createTestDb();
    await checkAiPrices(db, f, DAY);
    expect(db.select().from(aiPrices).all()).toEqual([]);
    expect(sonnetToday(db)).toMatchObject({ unconfirmed: { [SONNET]: why }, total: { cost: 2 } });
  });
});

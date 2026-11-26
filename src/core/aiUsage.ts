// What each person's AI calls use and cost, for the admin page. Every model
// call goes through aiFetch, which reads the tokens off the reply (Claude
// and Jev both report `usage`) and adds them to the person's row for the
// day, feature and model. Cost is worked out when it's read, from the price
// in effect each day (lib/aiPrices.ts), which a daily check of the published
// price lists keeps current on its own.

import { eq, gte, sql } from "drizzle-orm";
import {
  AI_MODELS,
  costOf,
  type DatedPrice,
  type PriceFeed,
  PRICE_FEED_URLS,
  priceOn,
  reviewPrice,
} from "../lib/aiPrices";
import { getEnv } from "../lib/env";
import { getPostHog } from "../lib/posthog";
import type { Db } from "./db";
import { aiPrices, aiUsage, meta } from "./schema";

const CHECKED_KEY = "aiPricesCheckedAt";
const UNCONFIRMED_KEY = "aiPricesUnconfirmed";
const DAY_MS = 24 * 60 * 60 * 1000;
const HOUR_MS = 60 * 60 * 1000;

const utcDay = (ts: number) => new Date(ts).toISOString().slice(0, 10);

/**
 * `base` (the global fetch by default), recording what each model call it
 * makes uses as `feature`'s, by `userId`: the signed-in person, or the
 * owner of the key an agent used. A call that fails or is cut short reports
 * nothing, so isn't counted, though the provider may bill part of it.
 */
export function aiFetch(db: Db, userId: string, feature: string, base: typeof fetch = fetch): typeof fetch {
  return async (input, init) => {
    const res = await base(input, init);
    if (!res.ok) return res;
    // Read here, so the row is written before the caller has its answer;
    // the caller reads the same text from the copy.
    const body = await res.text();
    try {
      const model = (JSON.parse(String(init?.body)) as { model?: unknown }).model;
      const usage = (JSON.parse(body) as { usage?: Record<string, unknown> }).usage;
      if (typeof model === "string" && usage) {
        const n = (v: unknown) => (typeof v === "number" && v >= 0 ? Math.round(v) : 0);
        recordAiUsage(db, userId, feature, model, {
          input: n(usage.input_tokens),
          output: n(usage.output_tokens),
          cacheRead: n(usage.cache_read_input_tokens),
          cacheWrite: n(usage.cache_creation_input_tokens),
        });
      }
    } catch {
      // A reply that isn't JSON: the caller deals with it, and there's
      // nothing to count. Counting is never worth failing the call over.
    }
    return new Response(body, { status: res.status, statusText: res.statusText, headers: res.headers });
  };
}

export function recordAiUsage(
  db: Db,
  userId: string,
  feature: string,
  model: string,
  t: { input: number; output: number; cacheRead: number; cacheWrite: number },
  now = Date.now(),
): void {
  // audit-exempt: telemetry about AI calls, not a change anyone made.
  db.insert(aiUsage)
    .values({
      userId,
      day: utcDay(now),
      feature,
      model,
      calls: 1,
      inputTokens: t.input,
      outputTokens: t.output,
      cacheReadTokens: t.cacheRead,
      cacheWriteTokens: t.cacheWrite,
    })
    .onConflictDoUpdate({
      target: [aiUsage.userId, aiUsage.day, aiUsage.feature, aiUsage.model],
      set: {
        calls: sql`${aiUsage.calls} + 1`,
        inputTokens: sql`${aiUsage.inputTokens} + ${t.input}`,
        outputTokens: sql`${aiUsage.outputTokens} + ${t.output}`,
        cacheReadTokens: sql`${aiUsage.cacheReadTokens} + ${t.cacheRead}`,
        cacheWriteTokens: sql`${aiUsage.cacheWriteTokens} + ${t.cacheWrite}`,
      },
    })
    .run();
}

export interface AiSpend {
  /** USD over the period. */
  cost: number;
  tokens: number;
  calls: number;
}

/**
 * AI spend since `since` (a UTC day): in all, by person, feature and day,
 * each day's tokens at that day's price. `unpriced` names models with tokens but
 * no price, which count as free; `unconfirmed` the ones whose price the
 * last check couldn't confirm, and why.
 */
export function aiSpend(db: Db, since: string) {
  const found = db.select().from(aiPrices).all();
  const rows = db.select().from(aiUsage).where(gte(aiUsage.day, since)).all();
  const total: AiSpend = { cost: 0, tokens: 0, calls: 0 };
  const byUser = new Map<string, AiSpend>();
  const byFeature = new Map<string, AiSpend>();
  const byDay = new Map<string, AiSpend>();
  const unpriced = new Set<string>();
  const add = (map: Map<string, AiSpend>, key: string, s: AiSpend) => {
    const to = map.get(key) ?? { cost: 0, tokens: 0, calls: 0 };
    map.set(key, { cost: to.cost + s.cost, tokens: to.tokens + s.tokens, calls: to.calls + s.calls });
  };
  for (const r of rows) {
    const tokens = { input: r.inputTokens, output: r.outputTokens, cacheRead: r.cacheReadTokens, cacheWrite: r.cacheWriteTokens };
    const price = priceOn(r.model, r.day, found.filter((p) => p.model === r.model));
    if (!price) unpriced.add(r.model);
    const s = {
      cost: price ? costOf(tokens, price) : 0,
      tokens: tokens.input + tokens.output + tokens.cacheRead + tokens.cacheWrite,
      calls: r.calls,
    };
    total.cost += s.cost;
    total.tokens += s.tokens;
    total.calls += s.calls;
    add(byUser, r.userId, s);
    add(byFeature, r.feature, s);
    add(byDay, r.day, s);
  }
  const checked = Number(readMeta(db, CHECKED_KEY));
  return {
    total,
    byUser,
    byFeature,
    byDay,
    unpriced: [...unpriced],
    unconfirmed: unconfirmedPrices(db),
    /** When prices were last checked; null before the first check. */
    checkedAt: checked > 0 ? checked : null,
  };
}

function readMeta(db: Db, key: string): string | null {
  return db.select().from(meta).where(eq(meta.key, key)).get()?.value ?? null;
}

function writeMeta(db: Db, key: string, value: string): void {
  // audit-exempt: price check bookkeeping, not a user action.
  db.insert(meta).values({ key, value }).onConflictDoUpdate({ target: meta.key, set: { value } }).run();
}

/** Models whose price the last check couldn't confirm, and why. */
function unconfirmedPrices(db: Db): Record<string, string> {
  try {
    return JSON.parse(readMeta(db, UNCONFIRMED_KEY) ?? "{}") as Record<string, string>;
  } catch {
    return {};
  }
}

/**
 * Checks each model's price against the published lists, and adds a price
 * from today when they agree it's changed. Prices it can't confirm stay as
 * they were and are noted for the admin page, so nobody has to act on it.
 */
export async function checkAiPrices(db: Db, fetchImpl: typeof fetch = fetch, now = Date.now()): Promise<void> {
  const lists: Partial<Record<PriceFeed, unknown | null>> = {};
  await Promise.all(
    (Object.entries(PRICE_FEED_URLS) as [PriceFeed, string][]).map(async ([feed, url]) => {
      try {
        const res = await fetchImpl(url, { signal: AbortSignal.timeout(60_000) });
        lists[feed] = res.ok ? await res.json() : null;
      } catch {
        lists[feed] = null;
      }
    }),
  );
  const today = utcDay(now);
  const unconfirmed: Record<string, string> = {};
  for (const model of Object.keys(AI_MODELS)) {
    const found = db.select().from(aiPrices).where(eq(aiPrices.model, model)).all();
    const current = priceOn(model, today, found);
    if (!current) continue;
    const review = reviewPrice(model, current, lists);
    if ("unconfirmed" in review) unconfirmed[model] = review.unconfirmed;
    if ("price" in review) {
      const row: DatedPrice & { model: string } = { model, from: today, ...review.price };
      // audit-exempt: a published price copied in, not anyone's action.
      db.insert(aiPrices)
        .values(row)
        .onConflictDoUpdate({ target: [aiPrices.model, aiPrices.from], set: review.price })
        .run();
    }
  }
  writeMeta(db, UNCONFIRMED_KEY, JSON.stringify(unconfirmed));
  // With neither list read, nothing was checked: the next hourly tick tries again.
  if (Object.values(lists).some((list) => list != null)) writeMeta(db, CHECKED_KEY, String(now));
}

declare global {
  var __sidetrackAiPriceTimer: NodeJS.Timeout | undefined;
}

/**
 * Checks prices once a day while AI is set up. Hourly ticks against the
 * last check's time, like backups, so deploys don't keep putting it off.
 */
export function scheduleAiPriceChecks(db: Db): void {
  const { TYPESAFE_API_KEY, ANTHROPIC_API_KEY } = getEnv();
  if ((!TYPESAFE_API_KEY && !ANTHROPIC_API_KEY) || globalThis.__sidetrackAiPriceTimer) return;
  const tick = async () => {
    try {
      const last = Number(readMeta(db, CHECKED_KEY) ?? 0);
      if (Date.now() - last >= DAY_MS) await checkAiPrices(db);
    } catch (err) {
      getPostHog()?.captureException(err);
    }
  };
  void tick();
  globalThis.__sidetrackAiPriceTimer = setInterval(() => void tick(), HOUR_MS);
  globalThis.__sidetrackAiPriceTimer.unref();
}


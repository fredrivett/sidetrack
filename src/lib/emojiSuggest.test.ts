import { describe, expect, it } from "vitest";
import { autoListIcon, suggestEmoji } from "./emojiSuggest";

const CONTEXT = { name: "Marathon training", summary: "", itemTitles: ["Long run"] };

function respond(status: number, body: unknown): typeof fetch {
  return async () => new Response(JSON.stringify(body), { status });
}

describe("suggestEmoji", () => {
  it("returns Jev's likely picks, then every other emoji it rates a fit, dropping the long tail", async () => {
    const fetchImpl = respond(200, {
      answers: {
        icon: {
          type: "choice",
          choice: "🏃",
          probabilities: {
            "💪": 0.1,
            "🏃": 0.6,
            // Not in EMOJI_OPTIONS: never offered, however likely.
            "🦄": 0.15,
            "🥾": 0.07,
            "🎯": 0.06,
            "📚": 0.02,
          },
        },
        // Rated on their own: a strong fit follows the picks even when it
        // rates above them, and the pick isn't offered twice.
        "fits:🏃": { type: "noul", noul: 0.97 },
        "fits:📚": { type: "noul", noul: 0.9 },
        "fits:🗓️": { type: "noul", noul: 0.75 },
        "fits:🌱": { type: "noul", noul: 0.69 },
      },
    });
    expect(await suggestEmoji(CONTEXT, "key", fetchImpl)).toEqual([
      "🏃",
      "💪",
      "🥾",
      "🎯",
      "📚",
      "🗓️",
    ]);
  });

  it("returns no suggestions when the request fails", async () => {
    expect(await suggestEmoji(CONTEXT, "bad", respond(401, {}))).toEqual([]);
    const offline: typeof fetch = async () => {
      throw new TypeError("fetch failed");
    };
    expect(await suggestEmoji(CONTEXT, "key", offline)).toEqual([]);
  });
});

describe("autoListIcon", () => {
  it("asks only for Jev's pick, since it keeps just the top one", async () => {
    let asked: string[] = [];
    const fetchImpl: typeof fetch = async (_url, init) => {
      asked = Object.keys(JSON.parse(String(init?.body)).questions);
      return new Response(
        JSON.stringify({ answers: { icon: { probabilities: { "💪": 0.2, "🏃": 0.8 } } } }),
      );
    };
    expect(await autoListIcon(CONTEXT, "key", fetchImpl)).toBe("🏃");
    expect(asked).toEqual(["icon"]);
  });
});

import { describe, expect, it } from "vitest";
import { suggestEmoji } from "./emojiSuggest";

const CONTEXT = { name: "Marathon training", summary: "", itemTitles: ["Long run"] };

function respond(status: number, body: unknown): typeof fetch {
  return async () => new Response(JSON.stringify(body), { status });
}

describe("suggestEmoji", () => {
  it("returns up to three known emoji, most likely first, dropping the long tail", async () => {
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
      },
    });
    expect(await suggestEmoji(CONTEXT, "key", fetchImpl)).toEqual([
      "🏃",
      "💪",
      "🥾",
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

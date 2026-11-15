// A minimal client for TypeSafe's Jev, a decision model: it reads some state
// and answers `choice` questions by picking from options we define, with a
// probability for each. Callers decide what's confident enough to show.
// Framework-agnostic: a plain fetch, no DB access.

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  /** Option key → what it means. The answer names one of these keys. */
  criteria: Record<string, string>;
}

/**
 * Ask Jev the questions about `state`, returning each question's option
 * probabilities, keyed by question id. Best effort: a failed request
 * (network, rate limit, bad key, a 5 s timeout) yields null, so callers just
 * suggest nothing. `fetchImpl` is injectable for tests.
 */
export async function askJev(
  state: unknown,
  questions: Record<string, ChoiceQuestion>,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, Record<string, number>> | null> {
  let res: Response;
  try {
    res = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ model: "jev-latest", state, questions }),
      signal: AbortSignal.timeout(5000),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as {
      answers?: Record<string, { probabilities?: Record<string, number> }>;
    };
    // Keep only real probabilities, so a malformed answer can't slip past a
    // caller's threshold (a comparison with NaN or a string is never true).
    return Object.fromEntries(
      Object.keys(questions).map((id) => [
        id,
        Object.fromEntries(
          Object.entries(body.answers?.[id]?.probabilities ?? {}).filter(
            ([, p]) => typeof p === "number" && p >= 0 && p <= 1,
          ),
        ),
      ]),
    );
  } catch {
    return null;
  }
}

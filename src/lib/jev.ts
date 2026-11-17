// A minimal client for TypeSafe's Jev, a decision model: it reads some state
// and answers `choice` questions by picking from options we define, with a
// probability for each, and `noul` (yes/no) questions with the probability of
// yes. Callers decide what's confident enough to show.
// Framework-agnostic: a plain fetch, no DB access.
//
// Shaping a call. Jev bills input as the state once plus every question in
// full (choice criteria included), and output grows with each question too.
// Each response reports `usage`, so measure a change against the live API.
// - Ask everything about one state in one request, not one request per
//   question: `checkDraftItem` asks duplicate and parent together.
// - Ask only what the caller uses. Questions dominate the bill: the emoji
//   fit questions are ~70% of a suggestion request, so `autoListIcon`, which
//   keeps only the top pick, skips them.
// - Put shared context in the state, not in each question. Check that a
//   leaner question keeps the answers before you trim it, though: dropping
//   each emoji's meaning from its fit question changed which emoji fit.

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";

export interface ChoiceQuestion {
  type: "choice";
  instructions: string;
  /** Option key → what it means. The answer names one of these keys. */
  criteria: Record<string, string>;
}

export interface NoulQuestion {
  type: "noul";
  instructions: string | Record<string, unknown>;
}

/**
 * Ask Jev the questions about `state`, returning each question's option
 * probabilities, keyed by question id; a noul's options are "true" and
 * "false". Best effort: a failed request
 * (network, rate limit, bad key, a 5 s timeout) yields null, so callers just
 * suggest nothing. `fetchImpl` is injectable for tests.
 */
export async function askJev(
  state: unknown,
  questions: Record<string, ChoiceQuestion | NoulQuestion>,
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
      answers?: Record<
        string,
        { probabilities?: Record<string, number>; noul?: number }
      >;
    };
    // Keep only real probabilities, so a malformed answer can't slip past a
    // caller's threshold (a comparison with NaN or a string is never true).
    return Object.fromEntries(
      Object.keys(questions).map((id) => {
        const answer = body.answers?.[id];
        const probabilities =
          typeof answer?.noul === "number"
            ? { true: answer.noul, false: 1 - answer.noul }
            : (answer?.probabilities ?? {});
        return [
          id,
          Object.fromEntries(
            Object.entries(probabilities).filter(
              ([, p]) => typeof p === "number" && p >= 0 && p <= 1,
            ),
          ),
        ];
      }),
    );
  } catch {
    return null;
  }
}

import type { AiReadInput, AiReadName, AiReadResult } from "@/app/api/ai/reads";

/**
 * Asks one of the AI reads (src/app/api/ai/reads.ts) for its answer, with the
 * input and result types that read declares. Not a Server Action, so a slow
 * model never holds up the page's saves. Pass `signal` to give up on an
 * answer nobody needs any more, which also stops the model request. Rejects
 * when it can't be had, such as offline, signed out or asked too often:
 * these are suggestions, so callers leave them out.
 */
export async function aiRead<N extends AiReadName>(
  name: N,
  input: AiReadInput<N>,
  signal?: AbortSignal,
): Promise<AiReadResult<N>> {
  const res = await fetch(`/api/ai/${name}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
    signal,
  });
  if (!res.ok) throw new Error(`${name} answered ${res.status}`);
  return res.json();
}

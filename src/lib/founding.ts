// The founding batches: the first 100 accounts on sidetrack.it, in three
// batches by user number (users.user_number). Signup shows the batch the next
// account joins, and each member keeps their batch name with their number.
// On only where FOUNDING_SEATS is set, so self-hosted instances never offer
// it. After the last batch fills, signup goes back to normal.

export interface FoundingBatch {
  /** The batch, as the signup ticket titles it. */
  name: string;
  /** One member, as their number reads: "Earliest adopter #4". */
  member: string;
  /** The batch's last user number. */
  last: number;
  pitch: string;
  /** The perks after free forever and the member's number. */
  extraPerks: string[];
}

export const FOUNDING_BATCHES: readonly FoundingBatch[] = [
  {
    name: "Earliest adopters",
    member: "Earliest adopter",
    last: 20,
    pitch:
      "Sidetrack is new and rough in places. Tell me what's missing or broken and I'll work on it.",
    extraPerks: ["Direct line to Fred"],
  },
  {
    name: "Earlier adopters",
    member: "Earlier adopter",
    last: 50,
    pitch:
      "Sidetrack is new and changes most weeks. Your feedback decides what gets built next.",
    extraPerks: [],
  },
  {
    name: "Early adopters",
    member: "Early adopter",
    last: 100,
    pitch: "A board for your side projects. New, and updated most weeks.",
    extraPerks: [],
  },
];

/**
 * The batch user number `n` belongs to, with its place in the batches and
 * its first number; null past the last batch.
 */
export function foundingBatch(
  n: number,
): { batch: FoundingBatch; index: number; first: number } | null {
  let first = 1;
  for (const [index, batch] of FOUNDING_BATCHES.entries()) {
    if (n >= first && n <= batch.last) return { batch, index, first };
    first = batch.last + 1;
  }
  return null;
}

/** A user number as a ticket prints it: at least three digits, "004". */
export function padUserNumber(n: number): string {
  return String(n).padStart(3, "0");
}

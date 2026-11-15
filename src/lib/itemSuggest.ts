// Jev suggestions for an item being written in the New item dialog: which
// list it belongs in, whether it repeats an open item, and which open item
// it's a step of. Each is a `choice` with a "none" option, and an answer only
// counts when Jev is confident, so a vague title suggests nothing.

import { askJev, type ChoiceQuestion } from "./jev";

// Jev's choice questions take at most 255 options; one is "none".
const MAX_OPTIONS = 254;
const NONE = "none";
// How likely the top answer must be before it's shown. At 0.5 the top answer
// also beats "none", since the probabilities sum to 1; a list is only a
// prefill you can see and change, so it needs less than a warning does.
const LIST_MIN = 0.5;
const DUPLICATE_MIN = 0.7;
const PARENT_MIN = 0.7;

export interface DraftItem {
  title: string;
  description: string;
}

export interface ListCandidate {
  id: string;
  name: string;
  summary: string;
  itemTitles: string[];
}

export interface ItemCandidate {
  id: string;
  title: string;
  /** Only top-level items can have sub-items. */
  topLevel: boolean;
}

function choice(
  instructions: string,
  options: Array<[id: string, meaning: string]>,
  none: string,
): ChoiceQuestion {
  return {
    type: "choice",
    instructions,
    criteria: Object.fromEntries([
      ...options.slice(0, MAX_OPTIONS),
      [NONE, none],
    ]),
  };
}

// The top option if it's a real one (not "none") and at least `min` likely.
function confident(
  probabilities: Record<string, number> | undefined,
  question: ChoiceQuestion | undefined,
  min: number,
): string | null {
  if (!probabilities || !question) return null;
  const [top] = Object.entries(probabilities).sort((a, b) => b[1] - a[1]);
  if (!top || top[0] === NONE || top[1] < min) return null;
  return Object.hasOwn(question.criteria, top[0]) ? top[0] : null;
}

/** The list the draft most likely belongs in, or null when none clearly fits. */
export async function suggestList(
  draft: DraftItem,
  lists: ListCandidate[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null> {
  if (lists.length === 0) return null;
  const question = choice(
    "Which to-do list should this new task go in?",
    lists.map((l) => [
      l.id,
      [
        `The list "${l.name}"`,
        l.summary && `about: ${l.summary}`,
        l.itemTitles.length > 0 && `with tasks like: ${l.itemTitles.join("; ")}`,
      ]
        .filter(Boolean)
        .join(", "),
    ]),
    "None of these lists clearly fits this task",
  );
  const answers = await askJev(
    { new_task: draft },
    { list: question },
    apiKey,
    fetchImpl,
  );
  return confident(answers?.list, question, LIST_MIN);
}

/**
 * Check the draft against a list's open items: one it repeats (`duplicateId`)
 * and one it's a step of, to go under as a sub-item (`parentId`). Either is
 * null when Jev isn't confident. One request answers both.
 */
export async function checkDraftItem(
  draft: DraftItem,
  items: ItemCandidate[],
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<{ duplicateId: string | null; parentId: string | null }> {
  const questions: Record<string, ChoiceQuestion> = {};
  if (items.length > 0) {
    questions.duplicate = choice(
      "Is the new task the same task as one already on the list, identical or reworded? Pick that task, or none if it's a different task.",
      items.map((it) => [it.id, it.title]),
      "None: the new task is different from all of these",
    );
  }
  const parents = items.filter((it) => it.topLevel);
  if (parents.length > 0) {
    questions.parent = choice(
      "Is the new task one step of a bigger task already on the list, so it belongs under it as a sub-item? Pick that task, or none.",
      parents.map((it) => [it.id, it.title]),
      "None: the new task stands on its own",
    );
  }
  if (Object.keys(questions).length === 0) {
    return { duplicateId: null, parentId: null };
  }
  const answers = await askJev(
    { new_task: draft },
    questions,
    apiKey,
    fetchImpl,
  );
  const duplicateId = confident(
    answers?.duplicate,
    questions.duplicate,
    DUPLICATE_MIN,
  );
  const parentId = confident(answers?.parent, questions.parent, PARENT_MIN);
  // A reworded copy of a task also reads as a step of it; it's a duplicate.
  return {
    duplicateId,
    parentId: parentId === duplicateId ? null : parentId,
  };
}

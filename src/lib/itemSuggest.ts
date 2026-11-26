// Jev suggestions for an item being written in the New item dialog: which
// list it belongs in, whether it repeats an open item or is a step of one,
// and what to fill in for it: when it's due, how it repeats, a label and who
// does it. Each is a `choice` with a "none" option, and an answer only counts
// when Jev is confident, so a vague title suggests nothing.

import { askJev, type ChoiceQuestion } from "./jev";
import { REPEAT_ONS, type Repeat, type RepeatOn } from "./repeat";

// Jev's choice questions take at most 255 options; one is "none".
const MAX_OPTIONS = 254;
const NONE = "none";
// How likely the top answer must be before it's shown. At 0.5 the top answer
// also beats "none", since the probabilities sum to 1; a list is only a
// prefill you can see and change, so it needs less than a warning does. The
// other prefills are as easy to change, but a wrong date or person is more
// likely to slip through unnoticed than a wrong list, so they need more.
const LIST_MIN = 0.5;
const DUPLICATE_MIN = 0.7;
const PARENT_MIN = 0.7;
const FIELD_MIN = 0.7;

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

/** A label or a person to choose from, by id. */
export interface NamedCandidate {
  id: string;
  name: string;
}

/**
 * When the item's due, as words parseDue reads from the day it's added:
 * the client turns them into dates, since it knows the viewer's today.
 */
export const DUE_WORDS = [
  "today",
  "tomorrow",
  "monday",
  "tuesday",
  "wednesday",
  "thursday",
  "friday",
  "saturday",
  "sunday",
  "this week",
  "this weekend",
  "next week",
  "next weekend",
] as const;
export type DueWord = (typeof DUE_WORDS)[number];

const DAY_NAMES: Record<RepeatOn, string> = {
  mon: "Monday",
  tue: "Tuesday",
  wed: "Wednesday",
  thu: "Thursday",
  fri: "Friday",
  sat: "Saturday",
  sun: "Sunday",
  weekend: "weekend",
};

// The repeats Jev can suggest: the common ones. Anything rarer is picked by hand.
const REPEATS: Record<string, [Repeat, string]> = {
  daily: [{ every: 1, unit: "day" }, "Repeats every day"],
  weekly: [{ every: 1, unit: "week" }, "Repeats every week, on no particular day"],
  ...Object.fromEntries(
    REPEAT_ONS.map((on) => [
      `weekly-${on}`,
      [{ every: 1, unit: "week", on }, `Repeats every ${DAY_NAMES[on]}`],
    ]),
  ),
  fortnightly: [{ every: 2, unit: "week" }, "Repeats every two weeks"],
  monthly: [{ every: 1, unit: "month" }, "Repeats every month"],
  yearly: [{ every: 12, unit: "month" }, "Repeats every year"],
};

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

/** What to ask about the draft. Each part left out isn't asked. */
export interface DraftQuestions {
  /** The lists it could go in, when none is chosen. */
  lists?: ListCandidate[];
  /** The open items on its list, to find one it repeats or is a step of. */
  items?: ItemCandidate[];
  /** Its list's labels. */
  labels?: NamedCandidate[];
  /** Who on its list can do it. */
  people?: NamedCandidate[];
  /** Whether to ask when it's due and how it repeats. */
  timing?: boolean;
}

export interface DraftAnswers {
  listId: string | null;
  /** An open item it's the same task as. */
  duplicateId: string | null;
  /** An open item it's one step of, to go under as a sub-item. */
  parentId: string | null;
  due: DueWord | null;
  repeat: Repeat | null;
  labelId: string | null;
  assigneeId: string | null;
}

const NOTHING: DraftAnswers = {
  listId: null,
  duplicateId: null,
  parentId: null,
  due: null,
  repeat: null,
  labelId: null,
  assigneeId: null,
};

/**
 * Ask Jev what it can tell about the draft, in one request; each answer is
 * null unless Jev is confident. A list's items, labels and people depend on
 * the list, so with no list chosen the caller asks for the list first.
 */
export async function askAboutDraft(
  draft: DraftItem,
  ask: DraftQuestions,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<DraftAnswers> {
  const questions: Record<string, ChoiceQuestion> = {};
  const { lists = [], items = [], labels = [], people = [] } = ask;
  if (lists.length > 0) {
    questions.list = choice(
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
  }
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
  if (ask.timing) {
    questions.due = choice(
      "Does the new task say when it's due? Pick the day or span it names, or none if it doesn't say.",
      DUE_WORDS.map((w) => [w, `Due ${w}`]),
      "None: the task doesn't say when it's due",
    );
    questions.repeat = choice(
      "Does the new task say it happens again and again? Pick how often, or none if it's done once.",
      Object.entries(REPEATS).map(([key, [, meaning]]) => [key, meaning]),
      "None: the task is done once",
    );
  }
  if (labels.length > 0) {
    questions.label = choice(
      "Which of the list's labels clearly fits the new task? Pick one, or none if none clearly fits.",
      labels.map((l) => [l.id, `The label "${l.name}"`]),
      "None of these labels clearly fits",
    );
  }
  if (people.length > 1) {
    questions.assignee = choice(
      "Does the new task say who should do it? Pick the person it names or is clearly for, or none if it doesn't say.",
      people.map((p) => [p.id, p.name]),
      "None: the task doesn't say who should do it",
    );
  }
  if (Object.keys(questions).length === 0) return NOTHING;
  const answers = await askJev({ new_task: draft }, questions, apiKey, fetchImpl);
  const pick = (id: string, min: number) => confident(answers?.[id], questions[id], min);
  const duplicateId = pick("duplicate", DUPLICATE_MIN);
  const parentId = pick("parent", PARENT_MIN);
  const repeat = pick("repeat", FIELD_MIN);
  return {
    listId: pick("list", LIST_MIN),
    duplicateId,
    // A reworded copy of a task also reads as a step of it; it's a duplicate.
    parentId: parentId === duplicateId ? null : parentId,
    due: pick("due", FIELD_MIN) as DueWord | null,
    repeat: repeat ? REPEATS[repeat][0] : null,
    labelId: pick("label", FIELD_MIN),
    assigneeId: pick("assignee", FIELD_MIN),
  };
}

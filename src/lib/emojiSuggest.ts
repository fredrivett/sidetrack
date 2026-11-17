// Suggest list icons and label emoji with TypeSafe's Jev, a decision model: it
// reads a list's name, summary, and item titles (or a label's name) and picks
// from a fixed set of emoji, returning a probability for each. It can only
// answer with an emoji from EMOJI_OPTIONS, so every suggestion is a valid,
// savable icon. Off unless TYPESAFE_API_KEY is set (see env.ts). No DB access.

import { askJev } from "./jev";

// Curated options for Jev's `choice` question (at most 255). Each label is
// what the model matches the list against, so it names the topics an emoji
// stands for, not the emoji's official name.
export const EMOJI_OPTIONS: Record<string, string> = {
  // Work & productivity
  "💼": "work, job, career, office",
  "📋": "tasks, checklist, to-dos, admin",
  "📅": "calendar, schedule, events, planning",
  "🎯": "goals, objectives, focus, targets",
  "📈": "growth, metrics, analytics, sales",
  "💡": "ideas, brainstorming, inspiration",
  "🚀": "launch, startup, side project, shipping",
  "🤝": "meetings, partnerships, clients, networking",
  "📣": "marketing, announcements, promotion",
  "🧾": "invoices, receipts, expenses, bills",
  "💰": "money, finances, budget, savings",
  "🏦": "banking, accounts, investments, pensions",
  "📊": "reports, data, spreadsheets, charts",
  "🗂️": "organizing, filing, paperwork",
  "📝": "notes, writing, drafts",
  "✉️": "email, letters, correspondence",
  "📞": "calls, phone, contacting people",
  "🧠": "learning, thinking, psychology, mental",
  "⏰": "deadlines, reminders, time-sensitive",
  "🏆": "achievements, competitions, wins",
  "⚖️": "legal, law, contracts, decisions",
  "🏢": "company, business, corporate",
  "🧑‍💼": "hiring, recruiting, HR, interviews",
  // Tech & building
  "💻": "coding, software, programming, computer",
  "🐛": "bugs, fixes, debugging, issues",
  "🔧": "maintenance, repairs, fixing, tools",
  "⚙️": "settings, infrastructure, configuration, ops",
  "🤖": "AI, automation, bots, machine learning",
  "📱": "mobile app, phone, iOS, Android",
  "🌐": "website, web, internet, domains",
  "🔒": "security, privacy, passwords",
  "🗄️": "database, storage, archive, servers",
  "🧪": "experiments, testing, science, research",
  "🔬": "research, analysis, lab work",
  "🎨": "design, art, painting, creative",
  "✏️": "sketching, drawing, editing",
  "📐": "architecture, planning, layouts, measurements",
  "🛠️": "DIY, building, tooling, projects",
  "🔌": "electronics, integrations, hardware",
  "🎮": "gaming, video games, game development",
  "🕹️": "retro games, arcade, playing",
  "📦": "packages, shipping, deliveries, releases",
  // Home & life
  "🏠": "home, house, household chores",
  "🧹": "cleaning, tidying, decluttering",
  "🛒": "shopping, groceries, errands",
  "🧺": "laundry, washing",
  "🛋️": "furniture, interior, living room",
  "🪴": "houseplants, indoor plants",
  "🌱": "gardening, growing, new beginnings",
  "🌻": "garden, flowers, outdoors",
  "🔑": "moving house, keys, rental, property",
  "🏡": "property, buying a house, renovation",
  "🔨": "renovation, building work, carpentry",
  "🎁": "gifts, presents, birthdays, wishlist",
  "🎂": "birthdays, celebrations, party",
  "🎉": "party, events, celebrations",
  "💍": "wedding, engagement, marriage",
  "👶": "baby, newborn, parenting",
  "👨‍👩‍👧": "family, kids, parenting",
  "🐶": "dog, pets",
  "🐱": "cat, pets",
  "🐾": "pets, animals, vet",
  "🚗": "car, driving, vehicle",
  "🚲": "cycling, bike",
  "🧳": "packing, luggage, trips",
  "🗓️": "weekly plan, routine, agenda",
  "📬": "post, mail, admin",
  "🧸": "kids, toys, childhood",
  "🏫": "school, education, classes",
  "🎓": "university, studying, graduation, degree",
  "📚": "books, reading, studying, library",
  "📖": "reading list, novels, literature",
  // Health & fitness
  "🏃": "running, exercise, cardio",
  "🏋️": "gym, weightlifting, strength training",
  "🧘": "yoga, meditation, mindfulness, calm",
  "🚴": "cycling training, spin",
  "🏊": "swimming, pool",
  "⚽": "football, soccer, team sports",
  "🏀": "basketball",
  "🎾": "tennis, padel, racket sports",
  "⛳": "golf",
  "🥾": "hiking, walking, trails",
  "🧗": "climbing, bouldering",
  "⛷️": "skiing, snowboarding, winter sports",
  "🏄": "surfing, water sports",
  "❤️": "health, love, relationships, self-care",
  "💊": "medication, pharmacy, prescriptions",
  "🩺": "doctor, medical, health checkups",
  "🦷": "dentist, teeth",
  "😴": "sleep, rest",
  "💪": "fitness, strength, motivation",
  "🥗": "diet, healthy eating, nutrition",
  // Food & drink
  "🍳": "cooking, breakfast, kitchen",
  "🍲": "recipes, meal prep, dinners",
  "🍕": "pizza, takeaway, fast food",
  "🍰": "baking, desserts, cakes",
  "🍞": "bread, bakery",
  "☕": "coffee, cafés",
  "🍷": "wine, drinks, dinner parties",
  "🍺": "beer, pubs, brewing",
  "🍸": "cocktails, bars, nightlife",
  "🍣": "sushi, Japanese food",
  "🌮": "Mexican food, tacos",
  "🍽️": "restaurants, dining out",
  "🍎": "fruit, healthy snacks",
  "🥕": "vegetables, vegan, vegetarian",
  // Travel & places
  "✈️": "travel, flights, holidays, vacation",
  "🌍": "world, travel bucket list, countries",
  "🗺️": "maps, itinerary, road trip planning",
  "🏖️": "beach holiday, summer",
  "🏕️": "camping, outdoors",
  "⛰️": "mountains, hiking trips",
  "🚆": "trains, commuting, rail",
  "🏙️": "city, city break, urban",
  "🏨": "hotels, accommodation, bookings",
  "🛂": "passport, visas, travel documents",
  "🌅": "mornings, sunrise, routines",
  "🌙": "evenings, night, bedtime",
  // Hobbies & culture
  "🎵": "music, songs, playlists",
  "🎸": "guitar, band, playing instruments",
  "🎹": "piano, keyboard, composing",
  "🎤": "singing, karaoke, podcasts, talks",
  "🎧": "listening, podcasts, audio",
  "🎬": "films, movies, video production",
  "📺": "TV shows, series, watchlist",
  "📷": "photography, photos, camera",
  "🎭": "theatre, drama, performing arts",
  "🎲": "board games, tabletop, games night",
  "🧩": "puzzles, problems to solve",
  "♟️": "chess, strategy",
  "🧶": "knitting, crochet, crafts",
  "🪡": "sewing, tailoring",
  "🖌️": "painting, illustration",
  "✍️": "writing, journaling, blog",
  "🎙️": "podcast, recording, interviews",
  "📰": "news, articles, newsletter",
  "🎟️": "tickets, gigs, concerts, events",
  "🎪": "festivals, fairs",
  "🎣": "fishing",
  "🌌": "astronomy, space, stargazing",
  "🦕": "dinosaurs, history, museums",
  "🏛️": "history, government, museums, civic",
  "🗳️": "politics, voting, campaigns",
  "⛪": "church, faith, religion",
  "🙏": "gratitude, prayer, volunteering",
  // Nature & environment
  "🌳": "nature, trees, environment",
  "♻️": "recycling, sustainability",
  "☀️": "summer, sunshine, weather",
  "❄️": "winter, snow, Christmas prep",
  "🍂": "autumn, fall",
  "🌸": "spring, blossom",
  "🌊": "ocean, sea, sailing",
  "🔥": "urgent, hot topics, priorities, burning",
  "⚡": "energy, quick wins, electricity",
  // Social & people
  "👥": "team, people, group, community",
  "💬": "conversations, chat, feedback, messages",
  "💌": "love letters, thank-you notes, invitations",
  "🧑‍🤝‍🧑": "friends, social plans",
  "🎄": "Christmas, holidays, festive",
  "🎃": "Halloween, autumn events",
  "🐣": "Easter, spring events",
  // Misc
  "⭐": "favourites, important, highlights",
  "✅": "done, completed, approvals",
  "❓": "questions, open issues, unknowns",
  "🔍": "search, investigation, research",
  "📌": "pinned, important, to remember",
  "🧭": "direction, life goals, planning",
  "🪄": "magic, wishes, someday",
  "🌈": "dreams, wellbeing, pride",
  "🛡️": "insurance, protection, safety",
  "🏥": "hospital, health admin",
  "🧰": "toolkit, resources, essentials",
};

// Jev's single pick is usually near-certain (🏃 at 100% for "Marathon
// training"), so its runners-up, each at least MIN_PROBABILITY, rarely add
// any. Alongside it Jev rates every emoji on its own ("would 💪 fit?"), and
// each it rates at least MIN_FIT follows the pick, so there are alternatives
// to choose from. The pick stays first: it's better at the single best one.
const MIN_PROBABILITY = 0.05;
const MIN_FIT = 0.7;
const fitId = (emoji: string) => `fits:${emoji}`;

export interface IconContext {
  name: string;
  summary: string;
  itemTitles: string[];
  // The list's homepage; only its domain is sent, which often names the topic.
  homepageUrl?: string | null;
}

function domainOf(url: string | null | undefined): string | undefined {
  if (!url) return undefined;
  try {
    return new URL(url).hostname || undefined;
  } catch {
    return undefined;
  }
}

/**
 * Ask Jev for icon suggestions, most likely first. Best effort: a failed
 * request (network, rate limit, bad key) yields [] so the picker just shows no
 * suggestions. Without `alternatives` only the picks come back, so a caller
 * that wants just the top one doesn't pay for the fit questions (Jev bills
 * every question). `fetchImpl` is injectable for tests.
 */
export function suggestEmoji(
  context: IconContext,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  alternatives = true,
): Promise<string[]> {
  return ask(
    {
      list_name: context.name,
      summary: context.summary,
      items: context.itemTitles,
      website: domainOf(context.homepageUrl),
    },
    "Which emoji best represents this to-do list as its icon?",
    alternatives ? "Would `emoji` be a fitting icon for this to-do list?" : null,
    apiKey,
    fetchImpl,
  );
}

/** The same for a label on a list's tasks, from its name and the list's. */
export function suggestLabelEmoji(
  context: { name: string; listName: string },
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
  alternatives = true,
): Promise<string[]> {
  return ask(
    { label: context.name, list_name: context.listName },
    "Which emoji best represents this label, used to tag tasks on the to-do list?",
    alternatives
      ? "Would `emoji` be a fitting icon for this label, used to tag tasks on the to-do list?"
      : null,
    apiKey,
    fetchImpl,
  );
}

async function ask(
  state: unknown,
  instructions: string,
  /** The same as a yes/no question about one `emoji`; null asks none. */
  fitQuestion: string | null,
  apiKey: string,
  fetchImpl: typeof fetch,
): Promise<string[]> {
  const emoji = fitQuestion ? Object.keys(EMOJI_OPTIONS) : [];
  const answers = await askJev(
    state,
    {
      icon: { type: "choice", instructions, criteria: EMOJI_OPTIONS },
      ...Object.fromEntries(
        emoji.map((e) => [
          fitId(e),
          {
            type: "noul" as const,
            instructions: {
              emoji: e,
              meaning: EMOJI_OPTIONS[e],
              question: fitQuestion,
            },
          },
        ]),
      ),
    },
    apiKey,
    fetchImpl,
  );
  if (!answers) return [];
  const ranked = (scores: [string, number][], min: number) =>
    scores
      .filter(([e, p]) => Object.hasOwn(EMOJI_OPTIONS, e) && p >= min)
      .sort((a, b) => b[1] - a[1])
      .map(([e]) => e);
  const picks = ranked(Object.entries(answers.icon ?? {}), MIN_PROBABILITY);
  const fits = ranked(
    emoji.map((e) => [e, answers[fitId(e)]?.true ?? 0]),
    MIN_FIT,
  );
  return [...new Set([...picks, ...fits])];
}

// An emoji nobody chose follows Jev's top suggestion for the text it goes
// with, as the pickers show it faded (see use-emoji-choice.ts). These are the
// same rule for saves the client couldn't show a suggestion for: an agent's,
// or one made before Jev answered.

/**
 * The icon for a list nobody chose one for, as it now reads: null when it
 * has a homepage (its favicon shows instead), else Jev's top suggestion.
 * Undefined leaves the icon as it is: AI is off or Jev has nothing to offer.
 */
export async function autoListIcon(
  context: IconContext,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<string | null | undefined> {
  if (context.homepageUrl) return null;
  if (!apiKey || !context.name.trim()) return undefined;
  return (await suggestEmoji(context, apiKey, fetchImpl, false))[0];
}

// At most this many labels are asked about at once (one request each), so a
// change adding many can't flood Jev; the rest get one when renamed or picked.
const MAX_AUTO_LABELS = 10;

/**
 * Jev's top emoji for each new label, by name, for the first
 * MAX_AUTO_LABELS of them; names it has none for are left out.
 */
export async function autoLabelEmoji(
  names: string[],
  listName: string,
  apiKey: string | undefined,
  fetchImpl: typeof fetch = fetch,
): Promise<Record<string, string>> {
  if (!apiKey) return {};
  const picks = await Promise.all(
    names.slice(0, MAX_AUTO_LABELS).map(async (name) => {
      const [top] = await suggestLabelEmoji({ name, listName }, apiKey, fetchImpl, false);
      return [name, top] as const;
    }),
  );
  return Object.fromEntries(picks.filter(([, top]) => top));
}

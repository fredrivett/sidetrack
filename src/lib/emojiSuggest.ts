// Suggest list icons with TypeSafe's Jev, a decision model: it reads a list's
// name, summary, and item titles and picks from a fixed set of emoji, returning
// a probability for each. It can only answer with an emoji from EMOJI_OPTIONS,
// so every suggestion is a valid, savable icon. Off unless TYPESAFE_API_KEY is
// set (see env.ts). Framework-agnostic: a plain fetch, no DB access.

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

const ENDPOINT = "https://api.typesafe.ai/v1/systemone";
// Up to three suggestions, each at least this likely, so the row shows a few
// real candidates rather than the long tail of a flat distribution.
const MAX_SUGGESTIONS = 3;
const MIN_PROBABILITY = 0.05;

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
 * suggestions. `fetchImpl` is injectable for tests.
 */
export async function suggestEmoji(
  context: IconContext,
  apiKey: string,
  fetchImpl: typeof fetch = fetch,
): Promise<string[]> {
  let res: Response;
  try {
    res = await fetchImpl(ENDPOINT, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "jev-latest",
        state: {
          list_name: context.name,
          summary: context.summary,
          items: context.itemTitles,
          website: domainOf(context.homepageUrl),
        },
        questions: {
          icon: {
            type: "choice",
            instructions:
              "Which emoji best represents this to-do list as its icon?",
            criteria: EMOJI_OPTIONS,
          },
        },
      }),
      signal: AbortSignal.timeout(5000),
    });
  } catch {
    return [];
  }
  if (!res.ok) return [];
  const body = (await res.json()) as {
    answers?: { icon?: { probabilities?: Record<string, number> } };
  };
  const probabilities = body.answers?.icon?.probabilities ?? {};
  return Object.entries(probabilities)
    .filter(([emoji, p]) => emoji in EMOJI_OPTIONS && p >= MIN_PROBABILITY)
    .sort((a, b) => b[1] - a[1])
    .slice(0, MAX_SUGGESTIONS)
    .map(([emoji]) => emoji);
}

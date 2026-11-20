// Calendar events from iCalendar text (RFC 5545), as the occurrences that
// fall in a window: each repeat of a recurring event worked out from its
// rule, with moved or changed ones (RECURRENCE-ID) and skipped ones (EXDATE)
// applied, in real time across daylight-saving changes. Cancelled events and
// ones the account's owner declined are left out. Titles and locations are
// other people's text (anyone can send an invite), so they're kept short and
// treated as data wherever they go. Framework-agnostic: no DB access.

import ICAL from "ical.js";

export interface Occurrence {
  uid: string;
  /** The occurrence's original start, for a repeat; "" for an event that doesn't repeat. */
  recurrenceId: string;
  title: string;
  location: string | null;
  /** When it starts and ends (ms). For an all-day event, midnight UTC of its first day and of the day after its last. */
  start: number;
  end: number;
  allDay: boolean;
  /** An all-day event's first and last day, YYYY-MM-DD; null for a timed one. */
  startDay: string | null;
  endDay: string | null;
  /** Not yet confirmed: the event is tentative, or the owner said maybe. */
  tentative: boolean;
}

const TEXT_MAX = 200;
/**
 * Repeats stepped through per event at most: a minutely rule started years
 * ago stops here rather than holding up the server. Repeats long before the
 * window cost only a step, so an hourly rule from a few years back is fine.
 */
const MAX_STEPS = 200_000;
/** Occurrences kept per event at most. */
const MAX_KEPT = 500;
/** No zone is more than 14 hours from UTC, so a wall-clock time is within this of its real time. */
const ZONE_SLACK_MS = 15 * 3_600_000;
const DAY_MS = 86_400_000;

const clip = (text: unknown) => {
  if (typeof text !== "string") return null;
  const one = text.replace(/\s+/g, " ").trim();
  return one ? Array.from(one).slice(0, TEXT_MAX).join("") : null;
};

// One formatter per zone: making one is far slower than using it.
const formatters = new Map<string, Intl.DateTimeFormat>();

/** How far `timeZone` is ahead of UTC at `ms`, in ms. */
function zoneOffset(ms: number, timeZone: string): number {
  let format = formatters.get(timeZone);
  if (!format) {
    format = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatters.set(timeZone, format);
  }
  const parts = format.formatToParts(ms);
  const n = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  return Date.UTC(n("year"), n("month") - 1, n("day"), n("hour"), n("minute"), n("second")) - (ms - (ms % 1000));
}

const isZone = (timeZone: string) => {
  try {
    zoneOffset(0, timeZone);
    return true;
  } catch {
    return false;
  }
};

/** A time's wall clock read as UTC (ms): within ZONE_SLACK_MS of when it really is, cheaply. */
const wallMs = (time: ICAL.Time) => Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);

/**
 * A timed ICAL.Time as ms. Times in a zone the data defined (VTIMEZONE), or
 * UTC, ical.js converts itself. One naming a zone it didn't define, such as
 * "Europe/London" alone, is read in that zone; a floating one, with no zone
 * at all, in `fallbackZone`.
 */
function toMs(time: ICAL.Time, fallbackZone: string): number {
  if (time.zone && time.zone.tzid !== "floating") return time.toUnixTime() * 1000;
  // ical.js keeps the TZID it couldn't resolve here, untyped.
  const tzid = (time as ICAL.Time & { timezone?: string }).timezone;
  const named = tzid && isZone(tzid) ? tzid : fallbackZone;
  const wall = Date.UTC(time.year, time.month - 1, time.day, time.hour, time.minute, time.second);
  // The offset at the wall time read as UTC, then again at the guess, for times near a change.
  const guess = wall - zoneOffset(wall, named);
  return wall - zoneOffset(guess, named);
}

const dayOf = (time: ICAL.Time) =>
  `${String(time.year).padStart(4, "0")}-${String(time.month).padStart(2, "0")}-${String(time.day).padStart(2, "0")}`;

/** The owner's answer to the invite, when they're on it as an attendee. */
function ownAnswer(event: ICAL.Event, addresses: Set<string>): string | null {
  for (const attendee of event.attendees) {
    const value = String(attendee.getFirstValue() ?? "").replace(/^mailto:/i, "").toLowerCase();
    if (addresses.has(value)) return String(attendee.getParameter("partstat") ?? "").toUpperCase() || null;
  }
  return null;
}

/**
 * Every occurrence in `ics` (one or more VCALENDAR texts, as CalDAV returns
 * them) overlapping `from` to `to` (ms), soonest first. `addresses` are the
 * owner's email addresses, to find their answer to an invite; `fallbackZone`
 * reads times that name no zone.
 */
export function eventsIn(
  ics: string[],
  window: { from: number; to: number },
  opts: { addresses: string[]; fallbackZone: string },
): Occurrence[] {
  const addresses = new Set(opts.addresses.map((a) => a.toLowerCase()));
  const out: Occurrence[] = [];
  for (const text of ics) {
    let root: ICAL.Component;
    try {
      root = new ICAL.Component(ICAL.parse(text));
    } catch {
      continue;
    }
    // Zones the data defines (VTIMEZONE) are read from the same data by
    // ical.js. They're never registered globally: a zone from one person's
    // invite must not change how anyone else's events are read.
    // A recurring event comes as its rule plus one VEVENT per changed repeat.
    const byUid = new Map<string, { master?: ICAL.Component; changed: ICAL.Component[] }>();
    for (const vevent of root.getAllSubcomponents("vevent")) {
      const uid = String(vevent.getFirstPropertyValue("uid") ?? "");
      const group = byUid.get(uid) ?? { changed: [] };
      if (vevent.hasProperty("recurrence-id")) group.changed.push(vevent);
      else group.master = vevent;
      byUid.set(uid, group);
    }
    for (const [uid, group] of byUid) {
      try {
        if (group.master) {
          const event = new ICAL.Event(group.master);
          for (const changed of group.changed) event.relateException(changed);
          if (!event.isRecurring()) {
            add(out, uid, "", event, event.startDate, event.endDate, window, addresses, opts.fallbackZone);
            continue;
          }
          // Repeats long before the window are only stepped past, unless a
          // changed repeat lands near the window, which could be any of them.
          const span = event.duration.toSeconds() * 1000;
          const movedNear = group.changed.some((c) => {
            const start = c.getFirstPropertyValue("dtstart");
            return start instanceof ICAL.Time && Math.abs(wallMs(start) - window.from) < window.to - window.from + 7 * DAY_MS;
          });
          const repeats = event.iterator();
          let kept = 0;
          for (let n = 0, next = repeats.next(); next && n < MAX_STEPS && kept < MAX_KEPT; n++, next = repeats.next()) {
            const wall = wallMs(next);
            // Repeats come in order of their original start. Stop a week past
            // the window, so one moved into it from a few days later still counts.
            if (wall >= window.to + 7 * DAY_MS + ZONE_SLACK_MS) break;
            if (!movedNear && wall + span + ZONE_SLACK_MS < window.from) continue;
            const details = event.getOccurrenceDetails(next);
            if (
              add(
                out,
                uid,
                details.recurrenceId.toString(),
                details.item,
                details.startDate,
                details.endDate,
                window,
                addresses,
                opts.fallbackZone,
              )
            ) {
              kept++;
            }
          }
        } else {
          // Only changed repeats, without their rule: each stands on its own.
          for (const changed of group.changed) {
            const event = new ICAL.Event(changed);
            add(out, uid, event.recurrenceId?.toString() ?? "", event, event.startDate, event.endDate, window, addresses, opts.fallbackZone);
          }
        }
      } catch {
        // One malformed event shouldn't lose the rest of the calendar.
      }
    }
  }
  return out.sort((a, b) => a.start - b.start || a.uid.localeCompare(b.uid));
}

function add(
  out: Occurrence[],
  uid: string,
  recurrenceId: string,
  event: ICAL.Event,
  startDate: ICAL.Time,
  endDate: ICAL.Time | null,
  window: { from: number; to: number },
  addresses: Set<string>,
  fallbackZone: string,
): boolean {
  const status = String(event.component.getFirstPropertyValue("status") ?? "").toUpperCase();
  if (status === "CANCELLED") return false;
  const answer = ownAnswer(event, addresses);
  if (answer === "DECLINED") return false;
  const allDay = startDate.isDate;
  let start: number;
  let end: number;
  let startDay: string | null = null;
  let endDay: string | null = null;
  if (allDay) {
    startDay = dayOf(startDate);
    start = Date.parse(`${startDay}T00:00:00Z`);
    // DTEND is the day after the last; with none, it's a one-day event.
    end = endDate?.isDate ? Date.parse(`${dayOf(endDate)}T00:00:00Z`) : start + DAY_MS;
    if (end <= start) end = start + DAY_MS;
    endDay = new Date(end - DAY_MS).toISOString().slice(0, 10);
  } else {
    start = toMs(startDate, fallbackZone);
    end = endDate ? toMs(endDate, fallbackZone) : start;
    if (end < start) end = start;
  }
  // Overlapping the window; an instant event counts at its start.
  if (start >= window.to || (end > start ? end <= window.from : start < window.from)) return false;
  out.push({
    uid,
    recurrenceId,
    title: clip(event.summary) ?? "Untitled event",
    location: clip(event.location),
    start,
    end,
    allDay,
    startDay,
    endDay,
    tentative: status === "TENTATIVE" || answer === "TENTATIVE",
  });
  return true;
}

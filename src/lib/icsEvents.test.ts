import { describe, expect, it } from "vitest";
import { eventsIn } from "./icsEvents";

const LONDON = `BEGIN:VTIMEZONE
TZID:Europe/London
BEGIN:DAYLIGHT
TZOFFSETFROM:+0000
TZOFFSETTO:+0100
DTSTART:19810329T010000
RRULE:FREQ=YEARLY;BYMONTH=3;BYDAY=-1SU
TZNAME:BST
END:DAYLIGHT
BEGIN:STANDARD
TZOFFSETFROM:+0100
TZOFFSETTO:+0000
DTSTART:19961027T020000
RRULE:FREQ=YEARLY;BYMONTH=10;BYDAY=-1SU
TZNAME:GMT
END:STANDARD
END:VTIMEZONE`;

const cal = (...parts: string[]) => `BEGIN:VCALENDAR\nVERSION:2.0\n${parts.join("\n")}\nEND:VCALENDAR`;
const ms = (iso: string) => Date.parse(iso);
const opts = { addresses: ["fred@example.com"], fallbackZone: "Europe/London" };

describe("eventsIn", () => {
  it("expands a weekly repeat across the clocks changing, with a moved and a skipped repeat", () => {
    const ics = cal(
      LONDON,
      `BEGIN:VEVENT
UID:standup
DTSTART;TZID=Europe/London:20261020T090000
DTEND;TZID=Europe/London:20261020T093000
RRULE:FREQ=WEEKLY
EXDATE;TZID=Europe/London:20261110T090000
SUMMARY:Standup
END:VEVENT`,
      `BEGIN:VEVENT
UID:standup
RECURRENCE-ID;TZID=Europe/London:20261103T090000
DTSTART;TZID=Europe/London:20261103T110000
DTEND;TZID=Europe/London:20261103T113000
SUMMARY:Standup (moved)
END:VEVENT`,
    );
    const found = eventsIn([ics], { from: ms("2026-10-19T00:00Z"), to: ms("2026-11-18T00:00Z") }, opts);
    expect(found.map((e) => [e.title, new Date(e.start).toISOString()])).toEqual([
      // 9am BST is 8am UTC; after 25 October, 9am GMT is 9am UTC.
      ["Standup", "2026-10-20T08:00:00.000Z"],
      ["Standup", "2026-10-27T09:00:00.000Z"],
      ["Standup (moved)", "2026-11-03T11:00:00.000Z"],
      // 10 November is skipped.
      ["Standup", "2026-11-17T09:00:00.000Z"],
    ]);
    expect(found[2].end - found[2].start).toBe(30 * 60_000);
  });

  it("counts a repeat moved into the window from just past it", () => {
    const ics = cal(
      `BEGIN:VEVENT
UID:r
DTSTART:20261101T100000Z
RRULE:FREQ=WEEKLY;COUNT=4
SUMMARY:Review
END:VEVENT`,
      `BEGIN:VEVENT
UID:r
RECURRENCE-ID:20261115T100000Z
DTSTART:20261112T100000Z
SUMMARY:Review (early)
END:VEVENT`,
    );
    const found = eventsIn([ics], { from: ms("2026-11-10T00:00Z"), to: ms("2026-11-14T00:00Z") }, opts);
    expect(found.map((e) => e.title)).toEqual(["Review (early)"]);
  });

  it("keeps all-day events as days, and reads a zone it wasn't given a definition for", () => {
    const ics = cal(
      `BEGIN:VEVENT
UID:hol
DTSTART;VALUE=DATE:20261123
DTEND;VALUE=DATE:20261126
SUMMARY:Holiday
END:VEVENT`,
      `BEGIN:VEVENT
UID:ny
DTSTART;TZID=America/New_York:20261124T090000
DTEND;TZID=America/New_York:20261124T100000
SUMMARY:NY call
END:VEVENT`,
    );
    const found = eventsIn([ics], { from: ms("2026-11-20T00:00Z"), to: ms("2026-12-01T00:00Z") }, opts);
    expect(found[0]).toMatchObject({ title: "Holiday", allDay: true, startDay: "2026-11-23", endDay: "2026-11-25" });
    // 9am in New York is 2pm UTC in November.
    expect(found[1]).toMatchObject({ title: "NY call", allDay: false, start: ms("2026-11-24T14:00Z") });
  });

  it("leaves out cancelled and declined events, and marks tentative ones", () => {
    const event = (uid: string, extra: string) => `BEGIN:VEVENT
UID:${uid}
DTSTART:20261121T100000Z
DTEND:20261121T110000Z
SUMMARY:${uid}
${extra}
END:VEVENT`;
    const ics = cal(
      event("cancelled", "STATUS:CANCELLED"),
      event("declined", "ATTENDEE;PARTSTAT=DECLINED:mailto:Fred@Example.com"),
      event("maybe", "ATTENDEE;PARTSTAT=TENTATIVE:mailto:fred@example.com"),
      event("someone-else-declined", "ATTENDEE;PARTSTAT=DECLINED:mailto:sam@example.com"),
    );
    const found = eventsIn([ics], { from: ms("2026-11-21T00:00Z"), to: ms("2026-11-22T00:00Z") }, opts);
    expect(found.map((e) => [e.title, e.tentative])).toEqual([
      ["maybe", true],
      ["someone-else-declined", false],
    ]);
  });

  it("skips data it can't read without losing the rest", () => {
    const good = cal(`BEGIN:VEVENT
UID:ok
DTSTART:20261121T100000Z
SUMMARY:Fine
END:VEVENT`);
    const found = eventsIn(["not a calendar", good], { from: ms("2026-11-21T00:00Z"), to: ms("2026-11-22T00:00Z") }, opts);
    expect(found.map((e) => e.title)).toEqual(["Fine"]);
  });
});

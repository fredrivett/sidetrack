import { describe, expect, it } from "vitest";
import { ExpandTimeoutError, expandEvents } from "./icsExpand";

const cal = (event: string) => `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\n${event}\nEND:VEVENT\nEND:VCALENDAR`;
const window = { from: Date.parse("2026-11-20T00:00Z"), to: Date.parse("2026-11-22T00:00Z") };
const opts = { addresses: [], fallbackZone: "UTC" };

describe("expandEvents", () => {
  it("works out events on another thread", async () => {
    const found = await expandEvents([cal("UID:a\nDTSTART:20261121T100000Z\nSUMMARY:Dentist")], window, opts);
    expect(found.map((e) => e.title)).toEqual(["Dentist"]);
  });

  it("stops a rule ical.js never finishes, without holding up this thread", async () => {
    // 30 February never comes, so ical.js looks for it without end.
    const never = cal("UID:b\nDTSTART:20261120T100000Z\nRRULE:FREQ=DAILY;BYMONTH=2;BYMONTHDAY=30\nSUMMARY:Never");
    const started = Date.now();
    let ticks = 0;
    const ticking = setInterval(() => ticks++, 50);
    await expect(expandEvents([never], window, opts, 1000)).rejects.toBeInstanceOf(ExpandTimeoutError);
    clearInterval(ticking);
    expect(Date.now() - started).toBeLessThan(3000);
    // This thread kept running meanwhile.
    expect(ticks).toBeGreaterThan(10);
  });
});

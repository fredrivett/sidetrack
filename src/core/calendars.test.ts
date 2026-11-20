import http from "node:http";
import type { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { listAudit } from "./audit";
import {
  type CalendarConfig,
  CalendarConnectError,
  connectICloud,
  disconnectCalendarAccount,
  listCalendarAccounts,
  setCalendarIncluded,
  syncCalendarAccount,
} from "./calendars";
import { calendarAccounts, calendarEvents } from "./schema";
import { createTestDb, createTestUser } from "./test-helpers";

// A stand-in CalDAV server, as iCloud answers: a principal, a calendar home
// with two calendars (one a reminders list), and events by REPORT.
const PASSWORD = "abcd-efgh-ijkl-mnop";
const state = {
  password: PASSWORD,
  ctag: "1",
  reports: 0,
  /** Where every request with a password went, by path. */
  authed: [] as string[],
  // Events relative to now, so the window always holds them.
  ics: "",
  /** Whether the calendar list includes Home and Work. */
  listed: { home: true, work: true },
  /** A status Work's REPORT answers instead of its events. */
  workStatus: 207,
  /** Holds Home's REPORT until it resolves. */
  hold: null as Promise<void> | null,
};
let server: http.Server;
let base = "";

const multistatus = (body: string) =>
  `<?xml version="1.0"?><d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/">${body}</d:multistatus>`;
const ok = (href: string, prop: string) =>
  `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${prop}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;

beforeAll(async () => {
  server = http.createServer((req, res) => {
    const auth = req.headers.authorization ?? "";
    state.authed.push(req.url ?? "");
    if (auth !== `Basic ${Buffer.from(`fred@icloud.com:${state.password}`).toString("base64")}`) {
      res.writeHead(401).end();
      return;
    }
    const send = (xml: string) => res.writeHead(207, { "Content-Type": "application/xml" }).end(multistatus(xml));
    if (req.url === "/") return send(ok("/", "<d:current-user-principal><d:href>/123/principal/</d:href></d:current-user-principal>"));
    if (req.url === "/123/principal/")
      return send(ok("/123/principal/", "<c:calendar-home-set><d:href>/123/calendars/</d:href></c:calendar-home-set>"));
    if (req.url === "/123/calendars/" && req.method === "PROPFIND")
      return send(
        ok("/123/calendars/", "<d:resourcetype><d:collection/></d:resourcetype>") +
          (state.listed.home
            ? ok(
                "/123/calendars/home/",
            `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Home</d:displayname><cs:getctag>${state.ctag}</cs:getctag><a:calendar-color>#FF2968FF</a:calendar-color><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>`,
              )
            : "") +
          (state.listed.work
            ? ok(
                "/123/calendars/work/",
                `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Work</d:displayname><cs:getctag>${state.ctag}</cs:getctag>`,
              )
            : "") +
          ok(
            "/123/calendars/tasks/",
            `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Reminders</d:displayname><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>`,
          ),
      );
    if (req.url === "/123/calendars/home/" && req.method === "REPORT") {
      state.reports++;
      const reply = () => send(ok("/123/calendars/home/a.ics", `<c:calendar-data>${state.ics}</c:calendar-data>`));
      if (state.hold) void state.hold.then(reply);
      else reply();
      return;
    }
    if (req.url === "/123/calendars/work/" && req.method === "REPORT") {
      if (state.workStatus !== 207) return void res.writeHead(state.workStatus).end();
      return send(ok("/123/calendars/work/b.ics", `<c:calendar-data>${eventAt("standup", "Standup", Date.now() + 3_600_000)}</c:calendar-data>`));
    }
    res.writeHead(404).end();
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/`;
});
afterAll(() => new Promise<void>((r) => server.close(() => r())));

const utc = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
const eventAt = (uid: string, title: string, start: number) =>
  `BEGIN:VCALENDAR\nVERSION:2.0\nBEGIN:VEVENT\nUID:${uid}\nDTSTART:${utc(start)}\nDTEND:${utc(start + 3_600_000)}\nSUMMARY:${title}\nEND:VEVENT\nEND:VCALENDAR`;

let config: CalendarConfig;
beforeEach(() => {
  Object.assign(state, {
    password: PASSWORD,
    ctag: "1",
    reports: 0,
    authed: [],
    listed: { home: true, work: true },
    workStatus: 207,
    hold: null,
  });
  state.ics = eventAt("dentist", "Dentist", Date.now() + 86_400_000);
  config = {
    key: randomBytes(32),
    serverUrl: base,
    allowUrl: (url) => url.host === new URL(base).host,
    allowAddress: () => true,
  };
});

function setup() {
  const { db } = createTestDb();
  const fred = createTestUser(db, { email: "fred@example.com" });
  return { db, fred };
}

describe("calendars", () => {
  it("connects, keeps the password sealed, and copies the events of event calendars", async () => {
    const { db, fred } = setup();
    const view = await connectICloud(db, fred, { username: "fred@icloud.com", password: " abcd-efgh-ijkl-mnop\n" }, "web", config);
    expect(view.calendars).toEqual([
      { id: expect.any(String), name: "Home", color: "#ff2968", included: true, events: 1 },
      { id: expect.any(String), name: "Work", color: null, included: true, events: 1 },
    ]);
    const row = db.select().from(calendarAccounts).get();
    expect(row?.secret).not.toContain(PASSWORD);
    expect(JSON.stringify(view)).not.toContain(PASSWORD);
    const audit = listAudit(db, fred, {});
    expect(audit.map((e) => e.detail)).toEqual(['connected the iCloud calendars of "fred@icloud.com"']);
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
    expect(db.select().from(calendarEvents).all().map((e) => e.title).sort()).toEqual(["Dentist", "Standup"]);
  });

  it("saves nothing when iCloud refuses the password", async () => {
    const { db, fred } = setup();
    await expect(
      connectICloud(db, fred, { username: "fred@icloud.com", password: "wrong" }, "web", config),
    ).rejects.toBeInstanceOf(CalendarConnectError);
    expect(listCalendarAccounts(db, fred)).toEqual([]);
    expect(listAudit(db, fred, {})).toEqual([]);
  });

  it("fetches events again only when the calendar changed", async () => {
    const { db, fred } = setup();
    const { id } = await connectICloud(db, fred, { username: "fred@icloud.com", password: PASSWORD }, "web", config);
    expect(state.reports).toBe(1);
    await syncCalendarAccount(db, id, config);
    expect(state.reports).toBe(1);
    state.ctag = "2";
    state.ics = eventAt("dentist", "Dentist (moved)", Date.now() + 2 * 86_400_000);
    await syncCalendarAccount(db, id, config);
    expect(state.reports).toBe(2);
    expect(db.select().from(calendarEvents).all().map((e) => e.title).sort()).toEqual(["Dentist (moved)", "Standup"]);
  });

  it("stops syncing once the password is revoked, until they sign in again", async () => {
    const { db, fred } = setup();
    const { id } = await connectICloud(db, fred, { username: "fred@icloud.com", password: PASSWORD }, "web", config);
    state.password = "new-pass-word-here";
    await syncCalendarAccount(db, id, config);
    expect(listCalendarAccounts(db, fred)[0]).toMatchObject({ needsReconnect: true, lastError: expect.stringMatching(/sign in again/) });
    const tries = state.authed.length;
    await syncCalendarAccount(db, id, config);
    expect(state.authed.length).toBe(tries);
    // Signing in again with the new password keeps the same account.
    const again = await connectICloud(db, fred, { username: "fred@icloud.com", password: state.password }, "web", config);
    expect(again).toMatchObject({ id, needsReconnect: false, lastError: null });
  });

  it("keeps calendars and choices when signing in again gets an empty list", async () => {
    const { db, fred } = setup();
    const view = await connectICloud(db, fred, { username: "fred@icloud.com", password: PASSWORD }, "web", config);
    const work = view.calendars.find((c) => c.name === "Work")?.id ?? "";
    setCalendarIncluded(db, fred, work, false, "web");
    const before = listCalendarAccounts(db, fred)[0].calendars;
    state.listed = { home: false, work: false };
    await expect(
      connectICloud(db, fred, { username: "fred@icloud.com", password: PASSWORD }, "web", config),
    ).rejects.toBeInstanceOf(CalendarConnectError);
    expect(listCalendarAccounts(db, fred)[0].calendars).toEqual(before);
  });

  it("asks to reconnect when the saved password can't be opened with the key", async () => {
    const { db, fred } = setup();
    const { id } = await connectICloud(db, fred, { username: "fred@icloud.com", password: PASSWORD }, "web", config);
    await syncCalendarAccount(db, id, { ...config, key: randomBytes(32) });
    expect(listCalendarAccounts(db, fred)[0].needsReconnect).toBe(true);
  });

  it("drops a calendar's events when it's left out, and only for its owner", async () => {
    const { db, fred } = setup();
    const sam = createTestUser(db);
    const view = await connectICloud(db, fred, { username: "fred@icloud.com", password: PASSWORD }, "web", config);
    const cal = view.calendars[0].id;
    expect(setCalendarIncluded(db, sam, cal, false, "web")).toBe(false);
    expect(disconnectCalendarAccount(db, sam, view.id, "web")).toBe(false);
    expect(setCalendarIncluded(db, fred, cal, false, "web")).toBe(true);
    expect(db.select().from(calendarEvents).where(eq(calendarEvents.calendarId, cal)).all()).toEqual([]);
    expect(listCalendarAccounts(db, fred)[0].calendars[0].included).toBe(false);
    expect(disconnectCalendarAccount(db, fred, view.id, "web")).toBe(true);
    expect(db.select().from(calendarAccounts).where(eq(calendarAccounts.userId, fred)).all()).toEqual([]);
  });

  it("never sends the password to a host it isn't allowed to", async () => {
    const { db, fred } = setup();
    await expect(
      connectICloud(db, fred, { username: "fred@icloud.com", password: PASSWORD }, "web", {
        ...config,
        allowUrl: (url) => url.hostname.endsWith(".icloud.com"),
      }),
    ).rejects.toBeInstanceOf(CalendarConnectError);
    expect(state.authed).toEqual([]);
  });

  it("keeps a calendar left out while a sync was fetching it", async () => {
    const { db, fred } = setup();
    const view = await connectICloud(db, fred, { username: "fred@icloud.com", password: PASSWORD }, "web", config);
    const home = view.calendars.find((c) => c.name === "Home")?.id ?? "";
    let release = () => {};
    state.hold = new Promise((r) => (release = r));
    state.ctag = "2";
    const syncing = syncCalendarAccount(db, view.id, config);
    while (state.reports < 2) await new Promise((r) => setTimeout(r, 5));
    setCalendarIncluded(db, fred, home, false, "web");
    release();
    await syncing;
    expect(db.select().from(calendarEvents).where(eq(calendarEvents.calendarId, home)).all()).toEqual([]);
  });

  it("keeps calendars and the owner's choices when one goes missing from an answer", async () => {
    const { db, fred } = setup();
    const view = await connectICloud(db, fred, { username: "fred@icloud.com", password: PASSWORD }, "web", config);
    const work = view.calendars.find((c) => c.name === "Work")?.id ?? "";
    setCalendarIncluded(db, fred, work, false, "web");
    const audited = listAudit(db, fred, {}).length;
    // An answer listing nothing is taken as a glitch: nothing changes.
    state.listed = { home: false, work: false };
    await syncCalendarAccount(db, view.id, config);
    expect(listCalendarAccounts(db, fred)[0]).toMatchObject({ lastError: expect.stringMatching(/no calendars/) });
    expect(listCalendarAccounts(db, fred)[0].calendars.map((c) => c.events)).toEqual([1, 0]);
    // Home gone for one sync: its copied events go, the rows stay.
    state.listed = { home: false, work: true };
    await syncCalendarAccount(db, view.id, config);
    const missing = listCalendarAccounts(db, fred)[0].calendars;
    expect(missing.map((c) => [c.name, c.included, c.events])).toEqual([
      ["Home", true, 0],
      ["Work", false, 0],
    ]);
    // Back again, as they were: Work still left out, Home fetched again.
    state.listed = { home: true, work: true };
    await syncCalendarAccount(db, view.id, config);
    const back = listCalendarAccounts(db, fred)[0].calendars;
    expect(back.map((c) => [c.id, c.included, c.events])).toEqual([
      [missing[0].id, true, 1],
      [work, false, 0],
    ]);
    expect(listAudit(db, fred, {})).toHaveLength(audited);
  });

  it("syncs the other calendars when one fails, without asking to sign in again", async () => {
    const { db, fred } = setup();
    state.workStatus = 403;
    const view = await connectICloud(db, fred, { username: "fred@icloud.com", password: PASSWORD }, "web", config);
    const account = listCalendarAccounts(db, fred)[0];
    expect(account).toMatchObject({ needsReconnect: false, lastSyncedAt: expect.any(Number), lastError: expect.stringMatching(/403/) });
    expect(account.calendars.map((c) => [c.name, c.events])).toEqual([
      ["Home", 1],
      ["Work", 0],
    ]);
    // Once it works again, the error clears.
    state.workStatus = 207;
    await syncCalendarAccount(db, view.id, config, Date.now() + 7 * 3_600_000);
    expect(listCalendarAccounts(db, fred)[0]).toMatchObject({ lastError: null });
  });
});

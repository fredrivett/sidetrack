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
          ok(
            "/123/calendars/home/",
            `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Home</d:displayname><cs:getctag>${state.ctag}</cs:getctag><a:calendar-color>#FF2968FF</a:calendar-color><c:supported-calendar-component-set><c:comp name="VEVENT"/></c:supported-calendar-component-set>`,
          ) +
          ok(
            "/123/calendars/tasks/",
            `<d:resourcetype><d:collection/><c:calendar/></d:resourcetype><d:displayname>Reminders</d:displayname><c:supported-calendar-component-set><c:comp name="VTODO"/></c:supported-calendar-component-set>`,
          ),
      );
    if (req.url === "/123/calendars/home/" && req.method === "REPORT") {
      state.reports++;
      return send(ok("/123/calendars/home/a.ics", `<c:calendar-data>${state.ics}</c:calendar-data>`));
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
  Object.assign(state, { password: PASSWORD, ctag: "1", reports: 0, authed: [] });
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
    ]);
    const row = db.select().from(calendarAccounts).get();
    expect(row?.secret).not.toContain(PASSWORD);
    expect(JSON.stringify(view)).not.toContain(PASSWORD);
    const audit = listAudit(db, fred, {});
    expect(audit.map((e) => e.detail)).toEqual(['connected the iCloud calendars of "fred@icloud.com"']);
    expect(JSON.stringify(audit)).not.toContain(PASSWORD);
    expect(db.select().from(calendarEvents).all().map((e) => e.title)).toEqual(["Dentist"]);
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
    expect(db.select().from(calendarEvents).all().map((e) => e.title)).toEqual(["Dentist (moved)"]);
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
    expect(db.select().from(calendarEvents).all()).toEqual([]);
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
});

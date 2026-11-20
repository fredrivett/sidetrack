// The little of CalDAV (RFC 4791) Sidetrack needs to read someone's calendars:
// find the account's calendars, then fetch the events in a window. Signs in
// with HTTP Basic, as iCloud's app-specific passwords do, and only ever sends
// that to the hosts `allowUrl` accepts (iCloud's, by default), checked on
// every request and every redirect, so a server can't send the password on
// somewhere else. Requests go through safeFetch, so they reach only public
// addresses, time out, and can't return more than a few megabytes.
// Framework-agnostic: no DB access. Errors never quote the password.

import { XMLParser } from "fast-xml-parser";
import { safeFetch } from "./safeFetch";

/** Where iCloud's CalDAV starts; it redirects each account to its own server. */
export const ICLOUD_CALDAV = "https://caldav.icloud.com/";

/** iCloud's CalDAV hosts: caldav.icloud.com and the pNN-caldav.icloud.com it sends people to. */
export const isICloudUrl = (url: URL) =>
  url.protocol === "https:" &&
  (url.port === "" || url.port === "443") &&
  /^(p\d+-)?caldav\.icloud\.com$/.test(url.hostname);

export interface CalDavOptions {
  username: string;
  password: string;
  /** Which URLs may receive the password. Default: iCloud's. */
  allowUrl?: (url: URL) => boolean;
  /** For tests, which serve from loopback; leave at safeFetch's default. */
  allowAddress?: (address: string) => boolean;
  signal?: AbortSignal;
}

/** The server refused the username and password. */
export class CalDavAuthError extends Error {
  constructor() {
    super("the calendar server refused the sign-in");
  }
}

/** Anything else that went wrong talking to the server. */
export class CalDavError extends Error {}

export interface RemoteCalendar {
  url: string;
  name: string;
  /** "#rrggbb", or null when the server gives none. */
  color: string | null;
  /** Changes whenever anything in the calendar does; null when the server keeps none. */
  ctag: string | null;
}

const MAX_BYTES = 8 * 1024 * 1024;
const TIMEOUT_MS = 20_000;
const MAX_REDIRECTS = 3;

const parser = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@_",
  parseTagValue: false,
  trimValues: true,
  isArray: (name) => name === "response" || name === "propstat" || name === "comp",
});

type Props = Record<string, unknown>;

/** One request, following redirects to allowed URLs only; the multistatus responses by URL. */
async function propRequest(
  url: string,
  method: "PROPFIND" | "REPORT",
  depth: "0" | "1",
  body: string,
  opts: CalDavOptions,
): Promise<Array<{ url: string; props: Props }>> {
  const allowUrl = opts.allowUrl ?? isICloudUrl;
  let current = new URL(url);
  for (let hop = 0; ; hop++) {
    if (!allowUrl(current)) throw new CalDavError(`refused to sign in to ${current.host}`);
    const res = await safeFetch(current.toString(), {
      maxBytes: MAX_BYTES,
      timeoutMs: TIMEOUT_MS,
      signal: opts.signal,
      allowAddress: opts.allowAddress,
      post: {
        method,
        body,
        headers: {
          Authorization: `Basic ${Buffer.from(`${opts.username}:${opts.password}`).toString("base64")}`,
          Depth: depth,
          "Content-Type": "application/xml; charset=utf-8",
          Accept: "application/xml",
          "User-Agent": "Sidetrack/1.0 (+https://sidetrack.it)",
        },
      },
    });
    // Only a 401 is the password: a 403 can be one calendar the account can't read any more.
    if (res.status === 401) throw new CalDavAuthError();
    if (res.location !== undefined) {
      if (hop >= MAX_REDIRECTS) throw new CalDavError("too many redirects");
      current = new URL(res.location, current);
      continue;
    }
    if (res.status !== 207) throw new CalDavError(`the calendar server answered ${res.status}`);
    if (res.truncated) throw new CalDavError("the calendar server sent too much");
    const xml = parser.parse(Buffer.from(res.body).toString("utf8"));
    const responses: unknown[] = xml?.multistatus?.response ?? [];
    return responses.flatMap((r) => {
      const { href, propstat = [] } = r as { href?: unknown; propstat?: Array<{ prop?: Props; status?: unknown }> };
      if (typeof href !== "string") return [];
      // Only the properties the server found: a 404 propstat lists the missing ones.
      const props = Object.assign(
        {},
        ...propstat.filter((p) => String(p.status ?? "").includes(" 200")).map((p) => p.prop ?? {}),
      ) as Props;
      return [{ url: new URL(href, current).toString(), props }];
    });
  }
}

const hrefOf = (value: unknown): string | null => {
  const href = (value as { href?: unknown } | undefined)?.href;
  return typeof href === "string" ? href : null;
};

const textOf = (value: unknown): string | null =>
  typeof value === "string" ? value : typeof (value as { "#text"?: unknown })?.["#text"] === "string"
    ? (value as { "#text": string })["#text"]
    : null;

/** The URL of the collection that holds the account's calendars. */
export async function findCalendarHome(serverUrl: string, opts: CalDavOptions): Promise<string> {
  const [principal] = await propRequest(
    serverUrl,
    "PROPFIND",
    "0",
    `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>`,
    opts,
  );
  const principalHref = hrefOf(principal?.props["current-user-principal"]);
  if (!principal || !principalHref) throw new CalDavError("the calendar server named no account");
  const principalUrl = new URL(principalHref, principal.url).toString();
  const [home] = await propRequest(
    principalUrl,
    "PROPFIND",
    "0",
    `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>`,
    opts,
  );
  const homeHref = hrefOf(home?.props["calendar-home-set"]);
  if (!home || !homeHref) throw new CalDavError("the account has no calendars");
  return new URL(homeHref, home.url).toString();
}

/** The calendars in `homeUrl` that hold events (not reminders lists, inboxes or the like). */
export async function listCalendars(homeUrl: string, opts: CalDavOptions): Promise<RemoteCalendar[]> {
  const found = await propRequest(
    homeUrl,
    "PROPFIND",
    "1",
    `<?xml version="1.0" encoding="utf-8"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/"><d:prop><d:resourcetype/><d:displayname/><cs:getctag/><a:calendar-color/><c:supported-calendar-component-set/></d:prop></d:propfind>`,
    opts,
  );
  return found.flatMap(({ url, props }) => {
    const type = props.resourcetype;
    if (!type || typeof type !== "object" || !("calendar" in type)) return [];
    const comps = (props["supported-calendar-component-set"] as { comp?: Array<{ "@_name"?: string }> } | undefined)
      ?.comp;
    // A calendar that says what it holds must hold events; one that doesn't say may.
    if (comps && !comps.some((c) => c["@_name"]?.toUpperCase() === "VEVENT")) return [];
    const color = textOf(props["calendar-color"])?.match(/^#[0-9a-f]{6}/i)?.[0].toLowerCase() ?? null;
    return [
      {
        url,
        name: textOf(props.displayname)?.trim() || "Calendar",
        color,
        ctag: textOf(props.getctag),
      },
    ];
  });
}

/** "20261120T000000Z", CalDAV's form of a UTC time. */
const davTime = (ms: number) => new Date(ms).toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/**
 * The iCalendar text of every event in `calendarUrl` with an occurrence
 * between `from` and `to` (ms): one resource per event, recurring ones with
 * their rule and exceptions, to expand with icsEvents.ts.
 */
export async function fetchEventData(
  calendarUrl: string,
  window: { from: number; to: number },
  opts: CalDavOptions,
): Promise<string[]> {
  const found = await propRequest(
    calendarUrl,
    "REPORT",
    "1",
    `<?xml version="1.0" encoding="utf-8"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-data/></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${davTime(window.from)}" end="${davTime(window.to)}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`,
    opts,
  );
  return found.flatMap(({ props }) => {
    const data = textOf(props["calendar-data"]);
    return data ? [data] : [];
  });
}

// Session replay records the page as rrweb DOM data. Its own options mask
// text and input values, but not attributes, and Sidetrack puts people's
// content in some: an item row's `aria-label` is "Complete <title>", tooltips
// repeat titles, and links go to their lists' homepages and PRs. Those would
// reach PostHog in the recording even though the player doesn't show them.

/** Attributes whose values can hold someone's content, masked like text. */
const PRIVATE_ATTRIBUTES = new Set([
  "aria-label",
  "aria-description",
  "aria-valuetext",
  "title",
  "alt",
  "href",
  "src",
]);

/**
 * Masks `PRIVATE_ATTRIBUTES` in rrweb data, in place, the way rrweb masks text:
 * each non-space character becomes `*`. Covers the shapes attributes take in
 * it: a full snapshot's node tree and added nodes (`attributes: { name: value }`)
 * and attribute changes (`attributes: [{ id, attributes: { … } }]`).
 */
export function maskReplayAttributes(data: unknown): void {
  if (Array.isArray(data)) {
    for (const d of data) maskReplayAttributes(d);
    return;
  }
  if (!data || typeof data !== "object") return;
  for (const [key, value] of Object.entries(data)) {
    if (key === "attributes" && value && typeof value === "object" && !Array.isArray(value)) {
      const attrs = value as Record<string, unknown>;
      for (const [name, v] of Object.entries(attrs)) {
        if (PRIVATE_ATTRIBUTES.has(name) && typeof v === "string") attrs[name] = v.replace(/\S/g, "*");
      }
    } else {
      maskReplayAttributes(value);
    }
  }
}

// Text is masked too, except the app's own words, so a replay reads like the
// app: the board's header, field names, fixed buttons and menu items. Mark
// such text with `data-replay-safe` on the element or one above it; anything
// unmarked stays masked, so a missed spot only shows as `***`. Mark the fixed
// text itself, not a container that also shows what people wrote, and put
// `data-private` on anything personal inside a marked part, such as an
// avatar's initial; it wins over any `data-replay-safe` around it.

/** Whether replays may show `el`'s text as it is. */
export function isReplaySafe(el: Element | null | undefined): boolean {
  return Boolean(el?.closest("[data-replay-safe]")) && !el?.closest("[data-private]");
}

/** rrweb's `maskTextFn`: the app's own text as it is, the rest as `*`s. */
export function maskReplayText(text: string, el?: Element | null): string {
  return isReplaySafe(el) ? text : text.replace(/\S/g, "*");
}

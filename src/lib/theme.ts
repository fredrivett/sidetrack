// The user's colour theme: follow the system, or force light or dark.
// Framework-agnostic so the root layout's inline script and the client share it.
//
// The choice lives in a `theme` cookie and is mirrored onto <html data-theme>,
// which the `dark` variant in globals.css keys off: "dark" forces dark,
// "light" forces light, anything else follows prefers-color-scheme in CSS, so
// "system" tracks OS changes live with no listener.

export const THEMES = ["system", "light", "dark"] as const;
export type Theme = (typeof THEMES)[number];

/** The browser bar's colour per mode: the board's background. */
export const THEME_COLORS = { light: "#fafafa", dark: "#0a0a0a" };

export const THEME_COOKIE = "theme";
const ONE_YEAR_IN_SECONDS = 60 * 60 * 24 * 365;
/** Carries a new choice to the site's other open tabs. */
const THEME_CHANNEL = "sidetrack:theme";

export function parseTheme(value: string | null | undefined): Theme {
  return value === "light" || value === "dark" ? value : "system";
}

/**
 * Applies a theme to the page: <html data-theme> for the CSS, and the browser
 * bar's colour. THEME_INIT_SCRIPT inlines its source, so it uses only its
 * arguments and the browser's globals.
 *
 * The theme-color tags are written here rather than through Next's
 * viewport.themeColor: React claims an existing tag with matching content as
 * its own when it hydrates, so tags added beside Next's don't survive a load.
 * Only this function writes them.
 */
function applyTheme(theme: Theme, colors: typeof THEME_COLORS) {
  document.documentElement.dataset.theme = theme;
  document.head.querySelectorAll('meta[name="theme-color"]').forEach((m) => m.remove());
  const add = (color: string, media?: string) => {
    const meta = document.createElement("meta");
    meta.name = "theme-color";
    meta.content = color;
    if (media) meta.setAttribute("media", media);
    document.head.append(meta);
  };
  if (theme === "system") {
    add(colors.light, "(prefers-color-scheme: light)");
    add(colors.dark, "(prefers-color-scheme: dark)");
    // Chrome's installed app ignores tags with a media query, painting its
    // title bar the manifest's dark theme_color instead, so it gets the
    // current mode's colour without one. Browsers take the first tag that
    // matches, so the others still use the ones above. THEME_INIT_SCRIPT
    // rewrites it when the system's mode changes.
    add(colors[matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"]);
  } else {
    add(colors[theme]);
  }
}

/**
 * Applies the cookie's theme before first paint, so no page flashes the wrong
 * mode, then applies the choices other tabs make (setTheme) and, on System,
 * the system's switches between light and dark while it's open.
 * Inlined in the root layout; built from constants only.
 */
export const THEME_INIT_SCRIPT = `try{var m=document.cookie.match(/(?:^|; )${THEME_COOKIE}=(light|dark)(?:;|$)/),a=(${applyTheme}),c=${JSON.stringify(THEME_COLORS)};a(m?m[1]:"system",c);matchMedia("(prefers-color-scheme: dark)").onchange=function(){var t=document.documentElement.dataset.theme;if(t==="system")a(t,c)};new BroadcastChannel(${JSON.stringify(THEME_CHANNEL)}).onmessage=function(e){a(e.data==="light"||e.data==="dark"?e.data:"system",c)}}catch(e){}`;

/**
 * Applies a theme to this page, remembers it for the next load, and tells the
 * site's other open tabs.
 */
export function setTheme(theme: Theme): void {
  applyTheme(theme, THEME_COLORS);
  const secure = location.protocol === "https:" ? "; Secure" : "";
  document.cookie = `${THEME_COOKIE}=${theme}; path=/; max-age=${ONE_YEAR_IN_SECONDS}; SameSite=Lax${secure}`;
  if (typeof BroadcastChannel === "undefined") return;
  const channel = new BroadcastChannel(THEME_CHANNEL);
  channel.postMessage(theme);
  channel.close();
}

// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import { setTheme, THEME_INIT_SCRIPT } from "./theme";

/** What the page loads as, given the cookies: the inline script's result. */
function loadPage(): string | undefined {
  document.head.innerHTML = "";
  delete document.documentElement.dataset.theme;
  new Function(THEME_INIT_SCRIPT)();
  return document.documentElement.dataset.theme;
}

/** The bar colour a browser picks: the first theme-color whose media matches. */
function themeColor(os: "light" | "dark"): string | undefined {
  const metas = [...document.querySelectorAll<HTMLMetaElement>('meta[name="theme-color"]')];
  return metas.find((m) => m.getAttribute("media")?.includes(os) ?? true)?.content;
}

describe("theme", () => {
  beforeEach(() => {
    document.cookie = "theme=; path=/; max-age=0";
    document.cookie = "xtheme=; path=/; max-age=0";
  });

  it("keeps the chosen theme across a reload", () => {
    for (const theme of ["dark", "light", "system"] as const) {
      setTheme(theme);
      expect(loadPage()).toBe(theme);
    }
  });

  it("follows the system without a valid theme cookie", () => {
    expect(loadPage()).toBe("system");
    document.cookie = "xtheme=dark; path=/";
    expect(loadPage()).toBe("system");
    document.cookie = "theme=darkish; path=/";
    expect(loadPage()).toBe("system");
  });

  it("colours the browser bar for the chosen theme, not the OS", () => {
    setTheme("dark");
    loadPage();
    expect(themeColor("light")).toBe("#0a0a0a");

    setTheme("light");
    expect(themeColor("dark")).toBe("#fafafa");

    setTheme("system");
    expect(themeColor("dark")).toBe("#0a0a0a");
    expect(themeColor("light")).toBe("#fafafa");
  });
});

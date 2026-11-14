// iOS doesn't build a launch screen from the manifest. Until an installed app
// paints, it shows the apple-touch-startup-image whose media query matches the
// device, and a blank screen when none matches, so there's one image per
// screen size and colour scheme. Each image is the logo mark, centred, on the
// skeleton's page background. Nothing lines up with the skeleton on purpose:
// the page starts below the status bar, whose height varies by model, so
// anything placed to match it would jump on some models.
// Rendered by src/app/icons/startup/[name]/route.tsx, linked by layout.tsx.

/** Screens in CSS pixels, portrait, with their pixel ratio. */
const IPHONES: [width: number, height: number, ratio: number][] = [
  [440, 956, 3], // 16 Pro Max, 17 Pro Max
  [430, 932, 3], // 14 Pro Max, 15 Plus, 15 Pro Max, 16 Plus
  [428, 926, 3], // 12 Pro Max, 13 Pro Max, 14 Plus
  [420, 912, 3], // Air
  [414, 896, 3], // XS Max, 11 Pro Max
  [414, 896, 2], // XR, 11
  [414, 736, 3], // 6s Plus, 7 Plus, 8 Plus
  [402, 874, 3], // 16 Pro, 17, 17 Pro
  [393, 852, 3], // 14 Pro, 15, 15 Pro, 16
  [390, 844, 3], // 12, 12 Pro, 13, 13 Pro, 14, 16e
  [375, 812, 3], // X, XS, 11 Pro, 12 mini, 13 mini
  [375, 667, 2], // 6s, 7, 8, SE (2nd and 3rd gen)
];

const IPADS: typeof IPHONES = [
  [1032, 1376, 2], // Pro 13" (M4)
  [1024, 1366, 2], // Pro 12.9", Air 13"
  [834, 1210, 2], // Pro 11" (M4)
  [834, 1194, 2], // Pro 11", Air 11" (M2)
  [834, 1112, 2], // Air 10.5"
  [820, 1180, 2], // Air 10.9", 10th gen and later
  [810, 1080, 2], // 10.2"
  [768, 1024, 2], // mini (5th gen), 9.7"
  [744, 1133, 2], // mini (6th gen and later)
];

/** The page background and text colour: neutral-50 on -900, -950 on -100. */
const COLORS = {
  light: { background: "#fafafa", foreground: "#171717" },
  dark: { background: "#0a0a0a", foreground: "#f5f5f5" },
} as const;

/** The mark's width in points. */
export const MARK_WIDTH = 64;

export type StartupImage = {
  name: string;
  width: number;
  height: number;
  ratio: number;
  background: string;
  foreground: string;
  media: string;
};

function images(
  [width, height, ratio]: [number, number, number],
  orientation: "portrait" | "landscape",
): StartupImage[] {
  // device-width is always the portrait width; the image is the screen as the
  // user holds it.
  const [w, h] =
    orientation === "portrait"
      ? [width * ratio, height * ratio]
      : [height * ratio, width * ratio];
  return (["light", "dark"] as const).map((scheme) => ({
    name: `${w}x${h}-${scheme}.png`,
    width: w,
    height: h,
    ratio,
    ...COLORS[scheme],
    media: `(device-width: ${width}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation}) and (prefers-color-scheme: ${scheme})`,
  }));
}

// The media queries leave out device-height: iOS 27 matches it against
// Safari's window height when the app is added, not the screen's, so no image
// matched and the app launched on black (https://webkit.org/b/326500). Screens
// that share a width and pixel ratio would then match the same queries, so
// only the first listed of them keeps an image (the 414pt @3x and 834pt @2x
// ones); the others get one a little off their height.
const SCREENS = [...IPHONES, ...IPADS].filter(
  ([width, , ratio], i, all) =>
    all.findIndex(([w, , r]) => w === width && r === ratio) === i,
);

// Both orientations: the manifest allows any, so an app can launch held sideways.
export const STARTUP_IMAGES: StartupImage[] = SCREENS.flatMap((screen) => [
  ...images(screen, "portrait"),
  ...images(screen, "landscape"),
]);

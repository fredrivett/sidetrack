// iOS doesn't build a launch screen from the manifest. Until an installed app
// paints, it shows the apple-touch-startup-image whose media query matches the
// device, and a blank screen when none matches, so there's one image per
// screen size and colour scheme. Each image is the skeleton's page background
// alone: the page starts below the status bar, whose height varies by model,
// so anything drawn on the image would jump when the page replaces it.
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

/** The page background behind the board skeleton: neutral-50 and -950. */
const BACKGROUNDS = { light: "#fafafa", dark: "#0a0a0a" } as const;

export type StartupImage = {
  name: string;
  width: number;
  height: number;
  background: string;
  media: string;
};

function images(
  [width, height, ratio]: [number, number, number],
  orientation: "portrait" | "landscape",
): StartupImage[] {
  // device-width and -height are always the portrait values; the image is
  // the screen as the user holds it.
  const [w, h] =
    orientation === "portrait"
      ? [width * ratio, height * ratio]
      : [height * ratio, width * ratio];
  return (["light", "dark"] as const).map((scheme) => ({
    name: `${w}x${h}-${scheme}.png`,
    width: w,
    height: h,
    background: BACKGROUNDS[scheme],
    media: `(device-width: ${width}px) and (device-height: ${height}px) and (-webkit-device-pixel-ratio: ${ratio}) and (orientation: ${orientation}) and (prefers-color-scheme: ${scheme})`,
  }));
}

// Both orientations: the manifest allows any, so an app can launch held sideways.
export const STARTUP_IMAGES: StartupImage[] = [...IPHONES, ...IPADS].flatMap(
  (screen) => [...images(screen, "portrait"), ...images(screen, "landscape")],
);

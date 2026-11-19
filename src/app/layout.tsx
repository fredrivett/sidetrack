import type { Metadata, Viewport } from "next";
import { LatestDeploy } from "@/components/LatestDeploy";
import { PhysicalKeyboard } from "@/components/PhysicalKeyboard";
import { ServiceWorker } from "@/components/ServiceWorker";
import { SubmitShortcut } from "@/components/SubmitShortcut";
import { CopyHoveredItemRef } from "@/components/CopyHoveredItemRef";
import { Toaster } from "@/components/ui/sonner";
import { getEnv } from "@/lib/env";
import { PHYSICAL_KEYBOARD_STORAGE_KEY } from "@/lib/keyboard";
import { STARTUP_IMAGES } from "@/lib/startupImages";
import { THEME_INIT_SCRIPT } from "@/lib/theme";
import { fontVariables } from "./fonts";
import { SITE_DESCRIPTION } from "./site";
import "./globals.css";

// A function, not an object, so metadataBase is read when the server runs:
// BETTER_AUTH_URL is set on the deployed instance, not at build. It turns the
// social card's path (opengraph-image.tsx) into the absolute URL link
// previews need.
export function generateMetadata(): Metadata {
  const url = getEnv().BETTER_AUTH_URL;
  return {
    metadataBase: url ? new URL(url) : undefined,
    title: { default: "Sidetrack", template: "%s · Sidetrack" },
    description: SITE_DESCRIPTION,
    applicationName: "Sidetrack",
    openGraph: {
      type: "website",
      siteName: "Sidetrack",
      title: "Sidetrack · the home for everything you get sidetracked by",
      description: SITE_DESCRIPTION,
    },
    twitter: { card: "summary_large_image" },
    appleWebApp: {
      capable: true,
      title: "Sidetrack",
      statusBarStyle: "default",
      startupImage: STARTUP_IMAGES.map(({ name, media }) => ({
        // Bump v when the images change: Cloudflare and browsers cache them by URL.
        url: `/icons/startup/${name}?v=2`,
        media,
      })),
    },
    icons: {
      apple: "/icons/apple-touch-icon.png",
    },
    // appleWebApp.capable emits only the unprefixed mobile-web-app-capable, and
    // iOS shows the startup images above only with the apple- prefixed tag.
    other: { "apple-mobile-web-app-capable": "yes" },
  };
}

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  // No themeColor: the theme script writes it, to follow the chosen theme
  // (applyTheme in lib/theme).
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: the inline scripts below add data-theme and
    // may add data-physical-keyboard before React hydrates.
    <html
      lang="en"
      className={`${fontVariables} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
        {/* Applies the chosen theme before first paint, on every page. */}
        <script dangerouslySetInnerHTML={{ __html: THEME_INIT_SCRIPT }} />
        {/* Restores PhysicalKeyboard's mark before first paint, so touch
            devices with a keyboard don't flash their shortcut hints in. */}
        <script
          dangerouslySetInnerHTML={{
            __html: `try{if(localStorage.getItem(${JSON.stringify(PHYSICAL_KEYBOARD_STORAGE_KEY)}))document.documentElement.dataset.physicalKeyboard=""}catch(e){}`,
          }}
        />
      </head>
      <body className="min-h-dvh bg-neutral-50 text-neutral-900 dark:bg-neutral-950 dark:text-neutral-100">
        {children}
        <Toaster />
        <ServiceWorker />
        <LatestDeploy />
        <PhysicalKeyboard />
        <SubmitShortcut />
        <CopyHoveredItemRef />
      </body>
    </html>
  );
}

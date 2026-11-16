import type { Metadata, Viewport } from "next";
import { LatestDeploy } from "@/components/LatestDeploy";
import { PhysicalKeyboard } from "@/components/PhysicalKeyboard";
import { ServiceWorker } from "@/components/ServiceWorker";
import { Toaster } from "@/components/ui/sonner";
import { PHYSICAL_KEYBOARD_STORAGE_KEY } from "@/lib/keyboard";
import { STARTUP_IMAGES } from "@/lib/startupImages";
import { fontVariables } from "./fonts";
import "./globals.css";

export const metadata: Metadata = {
  title: "Sidetrack",
  description: "Side-project tracker",
  applicationName: "Sidetrack",
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

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
  userScalable: false,
  viewportFit: "cover",
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#fafafa" },
    { media: "(prefers-color-scheme: dark)", color: "#0a0a0a" },
  ],
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    // suppressHydrationWarning: the inline script below may add
    // data-physical-keyboard before React hydrates.
    <html
      lang="en"
      className={`${fontVariables} h-full antialiased`}
      suppressHydrationWarning
    >
      <head>
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
      </body>
    </html>
  );
}

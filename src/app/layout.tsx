import type { Metadata, Viewport } from "next";
import { Geist } from "next/font/google";
import { LatestDeploy } from "@/components/LatestDeploy";
import { PhysicalKeyboard } from "@/components/PhysicalKeyboard";
import { ServiceWorker } from "@/components/ServiceWorker";
import { Toaster } from "@/components/ui/sonner";
import { STARTUP_IMAGES } from "@/lib/startupImages";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

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
    <html
      lang="en"
      className={`${geistSans.variable} h-full antialiased`}
    >
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

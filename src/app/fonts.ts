import { Geist, Geist_Mono } from "next/font/google";

// The app's only fonts. globals.css names them in --font-sans and
// --font-mono; loading them here adds their @font-face rules. Shared by the
// root layout and global-error, which replaces it and loads its own.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const fontVariables = `${geistSans.variable} ${geistMono.variable}`;

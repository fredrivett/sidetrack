import { Geist, Geist_Mono, Instrument_Serif, Literata } from "next/font/google";

// The app's fonts. globals.css names them in --font-sans, --font-mono,
// --font-display (the Agenda greeting's hello) and --font-serif (its prose); loading them here adds their @font-face rules. Shared by the
// root layout and global-error, which replaces it and loads its own.
const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// The greeting reads as a note to the reader rather than as interface: an
// italic display serif for its hello, and a light book serif for its prose.
const instrumentSerif = Instrument_Serif({
  variable: "--font-instrument-serif",
  subsets: ["latin"],
  weight: "400",
  style: "italic",
});

const literata = Literata({
  variable: "--font-literata",
  subsets: ["latin"],
  axes: ["opsz"],
});

export const fontVariables = `${geistSans.variable} ${geistMono.variable} ${instrumentSerif.variable} ${literata.variable}`;

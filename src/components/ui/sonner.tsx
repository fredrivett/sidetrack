"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

// The app's dark mode is driven entirely by `prefers-color-scheme` (no
// next-themes provider), so the toaster follows the system theme to match.
function Toaster(props: ToasterProps) {
  return <Sonner theme="system" className="toaster group" {...props} />;
}

export { Toaster };

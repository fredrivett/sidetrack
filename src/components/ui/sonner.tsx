"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";

// The app's dark mode is driven entirely by `prefers-color-scheme` (no
// next-themes provider), so the toaster follows the system theme to match.
// Sonner sets its own system font stack; toasts use the app's Geist instead.
// Inline, since Sonner injects its stylesheet at runtime, after the app's CSS.
function Toaster(props: ToasterProps) {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      style={{ fontFamily: "var(--font-sans)" }}
      {...props}
    />
  );
}

export { Toaster };

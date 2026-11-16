"use client";

import { Toaster as Sonner, type ToasterProps } from "sonner";
import { useTheme } from "@/components/use-theme";

// Toasts follow the user's theme (src/lib/theme.ts), which Sonner can't see
// from CSS. Sonner sets its own system font stack; toasts use the app's Geist
// instead. Inline, since Sonner injects its stylesheet at runtime, after the
// app's CSS.
function Toaster(props: ToasterProps) {
  const theme = useTheme();
  return (
    <Sonner
      theme={theme}
      className="toaster group"
      style={{ fontFamily: "var(--font-sans)" }}
      {...props}
    />
  );
}

export { Toaster };

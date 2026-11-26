import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Sidetrack",
    short_name: "Sidetrack",
    description: "Side-project tracker",
    // Opens into the cached skeleton, which moves on to the board (see
    // public/sw.js). id stays "/" so existing installs remain the same app.
    start_url: "/launch",
    id: "/",
    display: "standalone",
    // Chrome and Edge on a computer let the user hide the title bar, putting
    // the board's header beside the window controls (globals.css). Others
    // ignore it and use display.
    display_override: ["window-controls-overlay"],
    orientation: "any",
    background_color: "#0a0a0a",
    theme_color: "#0a0a0a",
    icons: [
      { src: "/icons/icon-192.png", sizes: "192x192", type: "image/png" },
      { src: "/icons/icon-512.png", sizes: "512x512", type: "image/png" },
      {
        src: "/icons/icon-512-maskable.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "maskable",
      },
    ],
  };
}

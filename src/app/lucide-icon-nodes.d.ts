// The shapes behind each lucide-react icon, which the social card
// (opengraph-image.tsx) draws itself: the components are client-only.
declare module "lucide-react/dist/esm/icons/*.mjs" {
  export const __iconNode: [string, Record<string, string>][];
}

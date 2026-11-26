// The shapes behind each lucide-react icon, which the social card
// (opengraph-image.tsx) draws itself: the components are client-only.
// lucide-react 1.16 exports `__iconNode` and 1.76 `__iconData` (nodeOf reads either).
declare module "lucide-react/dist/esm/icons/*.mjs" {
  export const __iconNode: [string, Record<string, string>][];
}

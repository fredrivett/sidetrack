import { encode } from "uqr";
import { cn } from "@/lib/utils";

/** A QR code for `text`, drawn as SVG modules, dark on white whatever the
 * theme so every camera reads it. `label` names it for screen readers. */
export function QrCode({
  text,
  label,
  className,
}: {
  text: string;
  label: string;
  className?: string;
}) {
  const { data, size } = encode(text, { border: 1 });
  const path = data
    .flatMap((row, y) => row.map((on, x) => (on ? `M${x} ${y}h1v1h-1z` : "")))
    .join("");
  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label={label}
      className={cn("size-28 rounded-md bg-white p-1", className)}
      shapeRendering="crispEdges"
    >
      <path d={path} fill="#0a0a0a" />
    </svg>
  );
}

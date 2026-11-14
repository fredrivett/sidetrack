import { ImageResponse } from "next/og";
import { MARK_WIDTH, STARTUP_IMAGES } from "@/lib/startupImages";

// The iOS startup images (see src/lib/startupImages.ts), rendered once at build.
export function generateStaticParams() {
  return STARTUP_IMAGES.map(({ name }) => ({ name }));
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const image = STARTUP_IMAGES.find((i) => i.name === name);
  if (!image) return new Response("Not found", { status: 404 });
  // The cards of public/icons/mark.svg (from scripts/icons/icon.svg).
  const width = MARK_WIDTH * image.ratio;
  return new ImageResponse(
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: image.background,
      }}
    >
      <svg
        viewBox="112 96 288 304"
        width={width}
        height={(width * 304) / 288}
        fill={image.foreground}
      >
        <rect x="144" y="96" width="256" height="48" rx="12" />
        <rect x="112" y="160" width="128" height="48" rx="12" />
        <rect x="128" y="224" width="256" height="48" rx="12" />
        <rect x="272" y="288" width="128" height="48" rx="12" />
        <rect x="112" y="352" width="256" height="48" rx="12" />
      </svg>
    </div>,
    { width: image.width, height: image.height },
  );
}

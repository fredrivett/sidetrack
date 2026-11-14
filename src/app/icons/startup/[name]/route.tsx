import { ImageResponse } from "next/og";
import { STARTUP_IMAGES } from "@/lib/startupImages";

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
  return new ImageResponse(
    <div style={{ width: "100%", height: "100%", background: image.background }} />,
    { width: image.width, height: image.height },
  );
}

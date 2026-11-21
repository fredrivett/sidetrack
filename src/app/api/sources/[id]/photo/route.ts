import { getCurrentSession } from "@/auth/session";
import { getDb } from "@/core/db";
import { getSourcePhoto } from "@/core/sources";

/** A photo an agent read, for its owner only: the review screen and its items show it. */
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) return new Response(null, { status: 401 });
  const { id } = await params;
  const photo = getSourcePhoto(getDb().db, session.user.id, id);
  if (!photo) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(photo.data), {
    headers: {
      "Content-Type": photo.contentType,
      // A source's photo never changes once uploaded.
      "Cache-Control": "private, max-age=31536000, immutable",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

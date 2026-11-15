import { getCurrentSession } from "@/auth/session";
import { getDb } from "@/core/db";
import { getUploadedAvatar } from "@/core/users";

/**
 * Serves a user's uploaded avatar (see setUploadedAvatar). Any signed-in user
 * may load any avatar: collaborators see each other's on shared lists. The URL
 * carries a version (?v=), so the response can be cached for good.
 */
export async function GET(
  _request: Request,
  { params }: { params: Promise<{ userId: string }> },
) {
  if (!(await getCurrentSession())) {
    return new Response(null, { status: 401 });
  }
  const { userId } = await params;
  const avatar = getUploadedAvatar(getDb().db, userId);
  if (!avatar) return new Response(null, { status: 404 });
  return new Response(new Uint8Array(avatar.data), {
    headers: {
      "Content-Type": avatar.contentType,
      "Cache-Control": "private, max-age=31536000, immutable",
      // Only ever an image: never sniff it as anything else, nor run anything.
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'; sandbox",
    },
  });
}

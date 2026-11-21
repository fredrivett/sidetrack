import { getDb } from "@/core/db";
import { PHOTO_MAX_BYTES, receiveSourcePhoto } from "@/core/sources";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Where an agent uploads the photo whose lines it proposed (add_from_photo):
// `curl -T photo.jpg <url>`. The URL's token is the credential, good once and
// for an hour, so the proxy lets /api/sources/upload/ through without a
// session. Errors are plain text, for the agent to read and act on.
async function upload(request: Request, { params }: { params: Promise<{ token: string }> }) {
  const length = Number(request.headers.get("content-length") ?? 0);
  if (length > PHOTO_MAX_BYTES) {
    return new Response("photo too large: at most 15 MB; resize it and retry\n", { status: 413 });
  }
  const { token } = await params;
  const bytes = new Uint8Array(await request.arrayBuffer());
  const result = receiveSourcePhoto(getDb().db, token, bytes);
  if (!result.ok) return new Response(`${result.error}\n`, { status: result.status });
  return new Response("uploaded: ask the user to review it in Sidetrack\n", { status: 200 });
}

export const PUT = upload;
export const POST = upload;

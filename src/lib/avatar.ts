// Where uploaded avatars are served. A user's `image` is either a pasted
// http(s) URL or this path for an image they uploaded (stored in the DB, see
// setUploadedAvatar). Shared by core, auth, and the profile UI.

/** The path an uploaded avatar is served from, versioned so a new upload busts caches. */
export function uploadedAvatarPath(userId: string, version: number): string {
  return `/api/avatars/${encodeURIComponent(userId)}?v=${version}`;
}

/** Whether `image` is this user's own uploaded avatar, rather than a pasted URL. */
export function isUploadedAvatar(
  userId: string,
  image: string | null | undefined,
): boolean {
  return !!image?.startsWith(`/api/avatars/${encodeURIComponent(userId)}?`);
}

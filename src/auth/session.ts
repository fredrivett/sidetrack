import { headers } from "next/headers";
import { notFound, redirect } from "next/navigation";
import { auth } from "@/auth/better-auth";
import { getEnv } from "@/lib/env";

export async function getCurrentSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireUserId(): Promise<string> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session.user.id;
}

/**
 * The signed-in user's id, if it's in ADMIN_USER_IDS. Anyone else gets a
 * 404, so the admin pages don't show they exist.
 */
export async function requireAdmin(): Promise<string> {
  const userId = await requireUserId();
  if (!getEnv().ADMIN_USER_IDS.includes(userId)) notFound();
  return userId;
}

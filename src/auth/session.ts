import { headers } from "next/headers";
import { redirect } from "next/navigation";
import { auth } from "@/auth/better-auth";

export async function getCurrentSession() {
  return auth.api.getSession({ headers: await headers() });
}

export async function requireUserId(): Promise<string> {
  const session = await getCurrentSession();
  if (!session) redirect("/login");
  return session.user.id;
}

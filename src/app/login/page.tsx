import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getWebToken, safeCompare, WEB_COOKIE } from "@/lib/auth";

async function login(formData: FormData) {
  "use server";
  const token = String(formData.get("token") ?? "");
  const next = String(formData.get("next") ?? "/") || "/";
  if (!safeCompare(token, getWebToken())) {
    redirect("/login?error=1" + (next !== "/" ? `&next=${encodeURIComponent(next)}` : ""));
  }
  const jar = await cookies();
  jar.set(WEB_COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
  redirect(next.startsWith("/") ? next : "/");
}

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string; error?: string }>;
}) {
  const { next, error } = await searchParams;
  return (
    <main className="min-h-dvh flex items-center justify-center p-6 bg-neutral-50 dark:bg-neutral-950">
      <form
        action={login}
        className="w-full max-w-sm space-y-4 rounded-2xl bg-white dark:bg-neutral-900 p-6 shadow-sm border border-neutral-200 dark:border-neutral-800"
      >
        <h1 className="text-lg font-medium">Sidetrack</h1>
        <p className="text-sm text-neutral-500">Paste your web token to continue.</p>
        <input type="hidden" name="next" value={next ?? "/"} />
        <input
          type="password"
          name="token"
          autoFocus
          autoComplete="off"
          className="w-full rounded-lg border border-neutral-300 dark:border-neutral-700 bg-transparent px-3 py-2 text-base focus:outline-none focus:ring-2 focus:ring-neutral-900 dark:focus:ring-neutral-100"
          placeholder="Token"
        />
        {error && (
          <p className="text-sm text-red-600">Wrong token.</p>
        )}
        <button
          type="submit"
          className="w-full rounded-lg bg-neutral-900 text-white dark:bg-white dark:text-neutral-900 py-2 text-sm font-medium"
        >
          Sign in
        </button>
      </form>
    </main>
  );
}

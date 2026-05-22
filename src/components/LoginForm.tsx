"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { signIn, signUp } from "@/lib/auth-client";

type Mode = "sign-in" | "sign-up";

export function LoginForm({
  allowSignUp,
  next,
}: {
  allowSignUp: boolean;
  next: string;
}) {
  const router = useRouter();
  const [mode, setMode] = useState<Mode>("sign-in");
  const [pending, setPending] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function onSubmit(formData: FormData) {
    setPending(true);
    setError(null);
    const email = String(formData.get("email") ?? "").trim();
    const password = String(formData.get("password") ?? "");
    const name = String(formData.get("name") ?? "").trim();

    try {
      if (mode === "sign-up") {
        const res = await signUp.email({ email, password, name: name || email });
        if (res.error) {
          setError(res.error.message ?? "Sign up failed.");
          return;
        }
      } else {
        const res = await signIn.email({ email, password });
        if (res.error) {
          setError(res.error.message ?? "Sign in failed.");
          return;
        }
      }
      router.push(next);
      router.refresh();
    } finally {
      setPending(false);
    }
  }

  return (
    <form action={onSubmit} className="space-y-3">
      {allowSignUp && (
        <div className="flex gap-1 rounded-lg bg-muted p-1 text-sm">
          <button
            type="button"
            onClick={() => setMode("sign-in")}
            className={`flex-1 rounded-md py-1 ${
              mode === "sign-in" ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            Sign in
          </button>
          <button
            type="button"
            onClick={() => setMode("sign-up")}
            className={`flex-1 rounded-md py-1 ${
              mode === "sign-up" ? "bg-background shadow-sm" : "text-muted-foreground"
            }`}
          >
            Sign up
          </button>
        </div>
      )}
      {mode === "sign-up" && (
        <Input name="name" autoComplete="name" placeholder="Name (optional)" />
      )}
      <Input
        name="email"
        type="email"
        autoComplete="email"
        placeholder="Email"
        required
        autoFocus
      />
      <Input
        name="password"
        type="password"
        autoComplete={mode === "sign-up" ? "new-password" : "current-password"}
        placeholder="Password"
        required
        minLength={8}
      />
      {error && <p className="text-sm text-destructive">{error}</p>}
      <Button type="submit" disabled={pending} className="w-full">
        {pending ? "…" : mode === "sign-up" ? "Create account" : "Sign in"}
      </Button>
    </form>
  );
}

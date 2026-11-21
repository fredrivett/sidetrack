import type { Metadata } from "next";
import { SettingsHeader } from "@/components/SettingsHeader";
import { headers } from "next/headers";
import { GithubWebhookPanel } from "@/components/GithubWebhookPanel";
import { getDb } from "@/core/db";
import { getGithubWebhook } from "@/core/github";
import { listLinkedRepos } from "@/core/prLinks";
import { getEnv } from "@/lib/env";
import { requireUserId } from "@/auth/session";

export const metadata: Metadata = { title: "GitHub webhook" };

export const dynamic = "force-dynamic";

export default async function GithubSettingsPage() {
  const userId = await requireUserId();
  const { db } = getDb();
  const webhook = getGithubWebhook(db, userId);
  // The public origin GitHub can reach: BETTER_AUTH_URL when set (required in
  // production), else the host this page was served from.
  const h = await headers();
  const origin =
    getEnv().BETTER_AUTH_URL?.replace(/\/$/, "") ??
    `${h.get("x-forwarded-proto") ?? "https"}://${h.get("host")}`;

  return (
    <>
      <SettingsHeader title="GitHub webhook">
        Name items in a pull request&apos;s title in square brackets, such as{" "}
        <code className="font-mono">Fix login [SDT-1]</code>, and Sidetrack links
        them to the PR, then unlinks any you edit out. When the PR merges, every
        item linked to it is completed.
      </SettingsHeader>
      <GithubWebhookPanel
        webhook={webhook}
        payloadUrl={webhook ? `${origin}/api/github/webhook/${webhook.id}` : null}
        repos={listLinkedRepos(db, userId)}
      />
    </>
  );
}

import Link from "next/link";
import { CalendarsPanel } from "@/components/CalendarsPanel";
import { calendarConfig, listCalendarAccounts } from "@/core/calendars";
import { getDb } from "@/core/db";
import { requireUserId } from "@/auth/session";

export const dynamic = "force-dynamic";

export default async function CalendarSettingsPage() {
  const userId = await requireUserId();
  const { db } = getDb();

  return (
    <main className="min-h-dvh px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-2xl space-y-6">
        <header className="space-y-1">
          <Link href="/" className="text-xs text-muted-foreground hover:underline">
            ← Back to board
          </Link>
          <h1 className="text-lg font-semibold tracking-tight">Calendars</h1>
          <p className="text-sm text-muted-foreground">
            Connect your calendars so your Brief knows what&apos;s on. Your events stay
            yours: nobody you share lists with sees them.
          </p>
        </header>
        {calendarConfig() ? (
          <CalendarsPanel accounts={listCalendarAccounts(db, userId)} />
        ) : (
          <p className="text-sm text-muted-foreground">
            Calendars aren&apos;t set up on this server. Whoever runs it can turn them on
            by setting <code className="font-mono">CALENDAR_SECRET_KEY</code>.
          </p>
        )}
      </div>
    </main>
  );
}

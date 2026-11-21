import type { Metadata } from "next";
import { SettingsHeader } from "@/components/SettingsHeader";
import { CalendarsPanel } from "@/components/CalendarsPanel";
import { calendarConfig, listCalendarAccounts } from "@/core/calendars";
import { getDb } from "@/core/db";
import { requireUserId } from "@/auth/session";

export const metadata: Metadata = { title: "Calendars" };

export const dynamic = "force-dynamic";

export default async function CalendarSettingsPage() {
  const userId = await requireUserId();
  const { db } = getDb();

  return (
    <>
      <SettingsHeader title="Calendars">
        Connect your calendars so your Brief knows what&apos;s on. Your events stay
        yours: nobody you share lists with sees them.
      </SettingsHeader>
      {calendarConfig() ? (
        <CalendarsPanel accounts={listCalendarAccounts(db, userId)} />
      ) : (
        <p className="text-sm text-muted-foreground">
          Calendars aren&apos;t set up on this server. Whoever runs it can turn them on
          by setting <code className="font-mono">CALENDAR_SECRET_KEY</code>.
        </p>
      )}
    </>
  );
}

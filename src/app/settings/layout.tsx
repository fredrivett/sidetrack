import { SettingsBack, SettingsNav } from "@/components/SettingsNav";

/**
 * Every settings page shares this frame: a way back, and on wider screens a
 * sidebar to move between settings without going through the board.
 */
export default function SettingsLayout({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-dvh px-4 py-6 sm:px-6">
      <div className="mx-auto max-w-4xl space-y-6">
        <SettingsBack />
        <div className="md:grid md:grid-cols-[12rem_minmax(0,1fr)] md:gap-10">
          <SettingsNav />
          <div className="max-w-2xl space-y-6">{children}</div>
        </div>
      </div>
    </main>
  );
}

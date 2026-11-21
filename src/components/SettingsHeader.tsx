/** A settings page's title, and what the page is for. */
export function SettingsHeader({
  title,
  children,
}: {
  title: string;
  /** What the page is for, a sentence or two. */
  children?: React.ReactNode;
}) {
  return (
    <header className="space-y-1">
      <h1 className="text-lg font-semibold tracking-tight">{title}</h1>
      {children && <p className="text-sm text-muted-foreground">{children}</p>}
    </header>
  );
}

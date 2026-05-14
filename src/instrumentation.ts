export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;
  const { runMigrations } = await import("./core/migrate");
  const { scheduleBackups } = await import("./core/backup");
  runMigrations();
  scheduleBackups();
}

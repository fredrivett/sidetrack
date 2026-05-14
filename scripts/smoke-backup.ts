import { runBackup } from "../src/core/backup";
import { runMigrations } from "../src/core/migrate";

runMigrations();
runBackup().then((p) => {
  console.log("backed up to:", p);
});

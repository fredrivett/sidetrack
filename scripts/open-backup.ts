// Opens a backup downloaded from the backup bucket into a plain SQLite file:
//   BACKUP_ENCRYPTION_KEY=... pnpm backup:open sidetrack-<time>.db.gz.enc
// writes sidetrack-<time>.db next to it. Restore that as in
// docs/self-hosting.md, "Backups".
import { readFileSync, writeFileSync } from "node:fs";
import { openBackup } from "../src/lib/backupSeal";
import { parseSecretKey } from "../src/lib/secretBox";

const [file] = process.argv.slice(2);
const key = parseSecretKey(process.env.BACKUP_ENCRYPTION_KEY ?? "");
if (!file || !key) {
  console.error("Usage: BACKUP_ENCRYPTION_KEY=<key> pnpm backup:open <file>.db.gz.enc");
  process.exit(1);
}
const out = file.replace(/\.gz\.enc$/, "");
writeFileSync(out, openBackup(readFileSync(file), key));
console.log(`wrote ${out}`);

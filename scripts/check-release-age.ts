// Fails a PR whose pnpm-lock.yaml adds a package version published more
// recently than pnpm-workspace.yaml's minimumReleaseAge (CI, on PRs).
// pnpm only applies that delay when it resolves; Dependabot regenerates the
// lockfile itself and pulls in the newest transitive versions, so this checks
// the result. Needs BASE_SHA, the commit the PR is compared against.
import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

const git = (...args: string[]) => execFileSync("git", args, { encoding: "utf8", maxBuffer: 1 << 28 });

/** The name@version keys of a lockfile's `packages:` section. */
function lockedPackages(lockfile: string): Set<string> {
  const section = lockfile.split(/^packages:$/m)[1]?.split(/^snapshots:$/m)[0] ?? "";
  return new Set([...section.matchAll(/^ {2}'?(@?[^@'\s]+@[^('\s:]+)/gm)].map((m) => m[1]));
}

const minutes = Number(/^minimumReleaseAge:\s*(\d+)/m.exec(readFileSync("pnpm-workspace.yaml", "utf8"))?.[1]);
if (!minutes) throw new Error("pnpm-workspace.yaml sets no minimumReleaseAge");
const cutoff = Date.now() - minutes * 60_000;

const before = lockedPackages(git("show", `${process.env.BASE_SHA}:pnpm-lock.yaml`));
const added = [...lockedPackages(readFileSync("pnpm-lock.yaml", "utf8"))].filter((p) => !before.has(p));

async function main() {
  const tooNew: string[] = [];
  for (const spec of added) {
    const at = spec.lastIndexOf("@");
    const [name, version] = [spec.slice(0, at), spec.slice(at + 1)];
    const res = await fetch(`https://registry.npmjs.org/${name.replace("/", "%2F")}`);
    if (!res.ok) throw new Error(`${name}: registry answered ${res.status}`);
    const published = ((await res.json()) as { time?: Record<string, string> }).time?.[version];
    if (!published) throw new Error(`${spec}: no publish time in the registry`);
    if (Date.parse(published) > cutoff) tooNew.push(`${spec} (published ${published})`);
  }

  console.log(`Checked ${added.length} package versions the lockfile adds.`);
  if (tooNew.length) {
    console.error(
      `These were published less than ${minutes / 1440} days ago (minimumReleaseAge):\n` +
        tooNew.map((p) => `  ${p}`).join("\n") +
        "\nPin them back with temporary pnpm overrides, or wait and rerun.",
    );
    process.exit(1);
  }
}

void main();

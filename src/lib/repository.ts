// A list's GitHub repository, stored as "owner/repo": the code an agent
// started on one of its items checks out. Pure string math, no DB or framework.

const OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
const REPO = /^[A-Za-z0-9._-]{1,100}$/;

/**
 * Normalize what someone pastes for a repository to "owner/repo". Accepts
 * "owner/repo", a github.com URL (with or without a scheme, a trailing ".git",
 * or a path past the repo, such as /pull/12) and an SSH remote
 * ("git@github.com:owner/repo.git"). Blank → null (the field is cleared).
 * Throws on anything else, including another host, since only GitHub
 * repositories can be checked out today.
 */
export function normalizeRepository(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed) return null;
  const path = trimmed
    .replace(/^git@github\.com:/i, "")
    .replace(/^(?:https?:\/\/)?(?:www\.)?github\.com\//i, "");
  const [owner, rawRepo] = path.split(/[/?#]/);
  const repo = rawRepo?.replace(/\.git$/i, "");
  // Another host's URL is left whole, and its first part ("https:",
  // "gitlab.com") isn't a valid owner, so it's refused here too.
  if (!owner || !repo || !OWNER.test(owner) || !REPO.test(repo) || /^\.+$/.test(repo)) {
    throw new Error(`invalid repository: ${raw}`);
  }
  return `${owner}/${repo}`;
}

export class GitSyncError extends Error {}

export interface CommitAndPushOptions {
  /** Absolute path to the repo working tree. */
  repoPath: string;
  /** One or more paths, relative to repoPath, to stage. */
  relativeFilePaths: string[];
  message: string;
  authorName: string;
  /** Defaults to a stable, documented placeholder identity. */
  authorEmail?: string;
}

function gitPushToken(): string {
  const token = process.env.GIT_PUSH_TOKEN;
  if (!token) {
    throw new GitSyncError("GIT_PUSH_TOKEN is not set. Add it to api/.env.local.");
  }
  return token;
}

/** Strips the push token out of git's stderr/stdout before it ever reaches a log or an HTTP response. */
function redact(text: string): string {
  const token = process.env.GIT_PUSH_TOKEN;
  let out = token ? text.split(token).join("<redacted>") : text;
  out = out.replace(/x-access-token:[^@]*@/g, "x-access-token:<redacted>@");
  return out;
}

async function run(cmd: string[], cwd: string): Promise<{ stdout: string; stderr: string; exitCode: number }> {
  const proc = Bun.spawn(cmd, { cwd, stdout: "pipe", stderr: "pipe" });
  const [stdout, stderr, exitCode] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, exitCode };
}

async function authenticatedRemoteUrl(repoPath: string): Promise<string> {
  const { stdout, exitCode } = await run(["git", "remote", "get-url", "origin"], repoPath);
  if (exitCode !== 0) {
    throw new GitSyncError(`Could not resolve the origin remote for ${repoPath}`);
  }
  const match = stdout.trim().match(/github\.com[:/]([^/]+\/[^/.]+?)(\.git)?$/);
  if (!match) {
    throw new GitSyncError(`Unrecognized GitHub remote URL for ${repoPath}`);
  }
  return `https://x-access-token:${gitPushToken()}@github.com/${match[1]}.git`;
}

function slugify(input: string): string {
  return input.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "admin";
}

/** Every call waits for the previous one to settle, so overlapping admin requests never run concurrent git operations against the same working tree. */
let queue: Promise<unknown> = Promise.resolve();

export function commitAndPushFile(opts: CommitAndPushOptions): Promise<void> {
  const task = queue.then(() => doCommitAndPush(opts));
  queue = task.catch(() => {});
  return task;
}

async function doCommitAndPush(opts: CommitAndPushOptions): Promise<void> {
  const { repoPath, relativeFilePaths, message, authorName } = opts;
  const authorEmail = opts.authorEmail ?? `${slugify(authorName)}@admin.opencigardb.local`;

  const add = await run(["git", "add", ...relativeFilePaths], repoPath);
  if (add.exitCode !== 0) {
    throw new GitSyncError(`git add failed: ${redact(add.stderr)}`);
  }

  const commit = await run(
    ["git", "commit", `--author=${authorName} <${authorEmail}>`, "-m", message],
    repoPath,
  );
  if (commit.exitCode !== 0) {
    if (/nothing to commit/i.test(commit.stdout + commit.stderr)) return;
    throw new GitSyncError(`git commit failed: ${redact(commit.stderr)}`);
  }

  const authUrl = await authenticatedRemoteUrl(repoPath);
  let push = await run(["git", "push", authUrl, "HEAD:main"], repoPath);
  if (push.exitCode !== 0) {
    const pull = await run(["git", "pull", "--rebase", authUrl, "main"], repoPath);
    if (pull.exitCode !== 0) {
      // Leave the working tree clean rather than stuck mid-rebase for the next call.
      await run(["git", "rebase", "--abort"], repoPath);
      throw new GitSyncError(`git push failed and rebase could not resolve it: ${redact(push.stderr)}`);
    }
    push = await run(["git", "push", authUrl, "HEAD:main"], repoPath);
    if (push.exitCode !== 0) {
      throw new GitSyncError(`git push failed after rebase: ${redact(push.stderr)}`);
    }
  }
}

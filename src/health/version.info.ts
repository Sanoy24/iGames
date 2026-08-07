import { execSync } from 'child_process';
import { join } from 'path';

/**
 * Build/runtime identity for the running backend, resolved ONCE at module load
 * (which is process start). Exposed via GET /health/version so you can confirm
 * at a glance which build is actually live after a deploy  "is the new code
 * running?" becomes a one-request check instead of a guess.
 *
 * Git values prefer explicit env vars (set these in Docker/CI where `.git` is
 * absent); otherwise they fall back to reading the local git checkout, and to
 * 'unknown' if neither is available. Nothing here can throw.
 */

function resolveGit(envValue: string | undefined, gitArgs: string): string {
    if (envValue && envValue.trim()) return envValue.trim();
    try {
        return execSync(`git ${gitArgs}`, {
            stdio: ['ignore', 'pipe', 'ignore'],
        })
            .toString()
            .trim();
    } catch {
        return 'unknown';
    }
}

function resolvePackageVersion(): string {
    try {
        // pm2/node run from the project root, so package.json is at cwd. This works
        // for both `node dist/main` and ts-node without guessing the dist depth.
        return (
            require(join(process.cwd(), 'package.json')).version ?? 'unknown'
        );
    } catch {
        return 'unknown';
    }
}

export const VERSION_INFO = Object.freeze({
    service: 'igames-backend',
    version: resolvePackageVersion(),
    gitCommit: resolveGit(
        process.env.GIT_COMMIT ?? process.env.SOURCE_COMMIT,
        'rev-parse --short HEAD',
    ),
    gitBranch: resolveGit(
        process.env.GIT_BRANCH ?? process.env.SOURCE_BRANCH,
        'rev-parse --abbrev-ref HEAD',
    ),
    /** ISO instant this process started (module first loaded). */
    startedAt: new Date().toISOString(),
});

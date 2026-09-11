// Cross-process file locking for the shared JSON database.
//
// When several PCs run the app against the same shared folder, every
// read-modify-write cycle MUST be protected by a lock, otherwise two PCs
// could overwrite each other's changes.
//
// - proper-lockfile creates a "<file>.lock" directory (mkdir based, works on SMB shares)
// - an in-process queue serializes operations inside this single server process
import lockfile from 'proper-lockfile';
import { config } from '../config.js';

const queues = new Map();

/**
 * Run `fn` while holding an exclusive lock on `targetPath` (an existing file).
 * Safe across processes/PCs sharing the folder.
 */
export async function withLock(targetPath, fn) {
  // Serialize within this process first (avoids self-lock retry storms).
  const previous = queues.get(targetPath) || Promise.resolve();
  let releaseQueue;
  const current = new Promise((resolve) => { releaseQueue = resolve; });
  queues.set(targetPath, previous.then(() => current));
  await previous;

  let releaseFileLock = null;
  try {
    releaseFileLock = await lockfile.lock(targetPath, {
      stale: config.lockStaleMs,
      update: Math.max(2000, Math.floor(config.lockStaleMs / 4)),
      retries: {
        retries: config.lockRetries,
        factor: 1.2,
        minTimeout: 40,
        maxTimeout: 600
      },
      // Avoid realpath resolution: some network shares / mapped drives fail it.
      realpath: false
    });
    return await fn();
  } finally {
    if (releaseFileLock) {
      await releaseFileLock().catch(() => {});
    }
    releaseQueue();
    if (queues.get(targetPath) === undefined) queues.delete(targetPath);
  }
}

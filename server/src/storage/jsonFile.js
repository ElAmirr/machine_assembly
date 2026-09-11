// Low-level JSON file read/write, safe for shared network folders.
//
// Writes are atomic: data goes to a temp file first, is flushed to disk,
// then renamed over the target. A reader never sees a half-written file,
// even if the PC loses power mid-write.
import fs from 'node:fs/promises';
import path from 'node:path';

const RENAME_RETRY_CODES = ['EPERM', 'EBUSY', 'EACCES'];

async function renameWithRetry(from, to, attempts = 6) {
  for (let i = 0; ; i += 1) {
    try {
      await fs.rename(from, to);
      return;
    } catch (err) {
      // Windows/antivirus/SMB can briefly lock the destination file; retry a few times.
      if (!RENAME_RETRY_CODES.includes(err.code) || i >= attempts) {
        await fs.rm(from, { force: true }).catch(() => {});
        throw err;
      }
      await new Promise((resolve) => setTimeout(resolve, 40 * (i + 1)));
    }
  }
}

export async function fileExists(filePath) {
  try {
    await fs.access(filePath);
    return true;
  } catch {
    return false;
  }
}

/** Read + parse a JSON file. Missing file => deep copy of fallback. */
export async function readJson(filePath, fallback) {
  let raw;
  try {
    raw = await fs.readFile(filePath, 'utf8');
  } catch (err) {
    if (err.code === 'ENOENT') return structuredClone(fallback);
    throw err;
  }
  if (!raw || !raw.trim()) return structuredClone(fallback);
  try {
    return JSON.parse(raw);
  } catch {
    // Corrupted file: move it aside so the app can still start, and tell the user.
    const corruptPath = `${filePath}.corrupt-${Date.now()}`;
    await fs.rename(filePath, corruptPath).catch(() => {});
    throw new Error(
      `Data file "${path.basename(filePath)}" was corrupted and has been moved to "${path.basename(corruptPath)}". ` +
      'Restore it from the backups folder or contact the administrator.'
    );
  }
}

/** Atomically write JSON to a file (temp file + rename). */
export async function writeJsonAtomic(filePath, data) {
  const dir = path.dirname(filePath);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`);
  const json = JSON.stringify(data, null, 2);
  const handle = await fs.open(tmp, 'w');
  try {
    await handle.writeFile(json, 'utf8');
    await handle.sync(); // flush before rename so a crash cannot leave an empty file
  } finally {
    await handle.close();
  }
  await renameWithRetry(tmp, filePath);
}

// Automatic backups of the JSON database into <data>/backups/<timestamp>/.
// Runs on server start and then periodically (BACKUP_INTERVAL_HOURS).
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { nowIso } from '../utils.js';

function backupsRoot() {
  return path.join(config.dataDir, 'backups');
}

/** Copy every *.json data file into a timestamped backup folder. */
export async function createBackup(reason = 'manual') {
  const stamp = new Date().toISOString().replace(/[:.]/g, '-');
  const dir = path.join(backupsRoot(), stamp);
  await fs.mkdir(dir, { recursive: true });

  const entries = await fs.readdir(config.dataDir, { withFileTypes: true });
  let count = 0;
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      await fs.copyFile(path.join(config.dataDir, entry.name), path.join(dir, entry.name));
      count += 1;
    }
  }
  await fs.writeFile(
    path.join(dir, 'backup-info.json'),
    JSON.stringify({ reason, at: nowIso(), files: count }, null, 2)
  );
  await pruneBackups();
  return { dir, files: count, at: nowIso() };
}

export async function listBackups() {
  try {
    const entries = await fs.readdir(backupsRoot(), { withFileTypes: true });
    const backups = [];
    for (const entry of entries) {
      if (!entry.isDirectory()) continue;
      let info = null;
      try {
        info = JSON.parse(await fs.readFile(path.join(backupsRoot(), entry.name, 'backup-info.json'), 'utf8'));
      } catch {
        info = { reason: 'unknown', at: null, files: null };
      }
      backups.push({ name: entry.name, ...info });
    }
    backups.sort((a, b) => String(b.name).localeCompare(String(a.name)));
    return backups.slice(0, 50);
  } catch {
    return [];
  }
}

async function pruneBackups() {
  const keep = Math.max(1, config.backupKeep);
  const entries = await fs.readdir(backupsRoot(), { withFileTypes: true });
  const dirs = entries.filter((e) => e.isDirectory()).map((e) => e.name).sort();
  while (dirs.length > keep) {
    const oldest = dirs.shift();
    await fs.rm(path.join(backupsRoot(), oldest), { recursive: true, force: true });
  }
}

let timer = null;

export function startBackupScheduler(logger = console) {
  if (timer) clearInterval(timer);
  const hours = config.backupIntervalHours;
  if (!hours || hours <= 0) return;
  timer = setInterval(async () => {
    try {
      const result = await createBackup('automatic');
      logger.log(`[backup] automatic backup created (${result.files} files) -> ${result.dir}`);
    } catch (err) {
      logger.error('[backup] automatic backup failed:', err.message);
    }
  }, hours * 60 * 60 * 1000);
  timer.unref?.();
}

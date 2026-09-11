import path from 'node:path';
import { fileURLToPath } from 'node:url';
import dotenv from 'dotenv';

// Repository root (folder that contains package.json / server / client)
export const ROOT_DIR = path.resolve(fileURLToPath(new URL('../../', import.meta.url)));

dotenv.config({ path: path.join(ROOT_DIR, '.env') });

const env = process.env;

function num(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export const config = {
  appName: env.APP_NAME || 'Machine Assembly Manager',
  port: num(env.PORT, 4000),
  // Where all JSON data files + attachments live.
  // Can point to a shared network folder (\\SERVER\share\folder or Z:\folder)
  dataDir: path.resolve(ROOT_DIR, env.DATA_DIR || 'data'),
  jwtSecret: env.JWT_SECRET || 'change-me-to-a-long-random-secret-string',
  tokenHours: num(env.TOKEN_HOURS, 24),
  maxUploadBytes: num(env.MAX_UPLOAD_MB, 50) * 1024 * 1024,
  lockStaleMs: num(env.LOCK_STALE_MS, 20000),
  lockRetries: num(env.LOCK_RETRIES, 30),
  backupIntervalHours: num(env.BACKUP_INTERVAL_HOURS, 24),
  backupKeep: num(env.BACKUP_KEEP, 10),
  distDir: path.join(ROOT_DIR, 'dist'),
  isDefaultSecret: !env.JWT_SECRET || env.JWT_SECRET.includes('change-me')
};

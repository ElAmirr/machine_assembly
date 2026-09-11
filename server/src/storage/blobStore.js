// Attachment file storage abstraction (spec section 42).
//
// The current driver stores uploaded files inside the data folder
// (which can be a shared network folder). Because everything goes through
// this module, a different driver (S3, company storage, ...) can be added
// later without touching any route.
import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config.js';
import { newId } from '../utils.js';

export const storageDriverName = 'shared-folder';

function attachmentsDir() {
  return path.join(config.dataDir, 'attachments');
}

export async function initBlobStore() {
  await fs.mkdir(attachmentsDir(), { recursive: true });
}

/** Save a buffer, returns { storedRel, size }. storedRel is relative to DATA_DIR. */
export async function saveBlob(buffer, originalName) {
  const ext = path.extname(String(originalName || '')).slice(0, 16).toLowerCase();
  const month = new Date().toISOString().slice(0, 7); // YYYY-MM bucket
  const folderAbs = path.join(attachmentsDir(), month);
  await fs.mkdir(folderAbs, { recursive: true });
  const storedName = `${newId('file')}${ext}`;
  const abs = path.join(folderAbs, storedName);
  // writeFile with the full buffer is fine for the configured size limit (<= 50 MB default)
  await fs.writeFile(abs, buffer);
  return {
    storedRel: `attachments/${month}/${storedName}`,
    size: buffer.length
  };
}

export function blobAbsPath(storedRel) {
  const parts = String(storedRel || '').split('/').filter((p) => p && p !== '..' && p !== '.');
  return path.join(config.dataDir, ...parts);
}

export async function readBlob(storedRel) {
  return fs.readFile(blobAbsPath(storedRel));
}

export async function deleteBlob(storedRel) {
  try {
    await fs.rm(blobAbsPath(storedRel), { force: true });
  } catch {
    // already gone - ignore
  }
}

export async function blobExists(storedRel) {
  try {
    await fs.access(blobAbsPath(storedRel));
    return true;
  } catch {
    return false;
  }
}

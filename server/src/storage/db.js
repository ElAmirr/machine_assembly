// Central registry of all JSON collections.
// Every "table" of the system is one .json file inside the data folder
// (local folder or shared network folder, see DATA_DIR in .env).
import fs from 'node:fs/promises';
import path from 'node:path';
import { Collection, Singleton } from './collection.js';
import { writeJsonAtomic } from './jsonFile.js';
import { config } from '../config.js';

export const collections = {};
export const singletons = {};

const COLLECTION_DEFS = {
  roles: [],
  users: [],
  departments: [],
  locations: [],
  projectTypes: [],
  evidenceTypes: [],
  workflowTemplates: [],
  projects: [],
  tasks: [],
  components: [],
  tools: [],
  attachments: [],
  evidence: [],
  approvals: [],
  comments: [],
  notifications: [],
  auditLogs: []
};

// Single-document files
const SINGLETON_DEFS = {
  settings: {},
  counters: { project: 0 }
};

let initialized = false;

/** Create the data folder + all files if needed, and verify it is writable. */
export async function initStorage() {
  if (initialized) return collections;

  try {
    await fs.mkdir(config.dataDir, { recursive: true });
  } catch (err) {
    throw new Error(`Cannot create/open data folder "${config.dataDir}": ${err.message}`);
  }

  // Writability check - fails fast with a clear message when a network share is read-only/offline.
  const probe = path.join(config.dataDir, `.write-test-${process.pid}`);
  try {
    await fs.writeFile(probe, 'ok', 'utf8');
    await fs.rm(probe, { force: true });
  } catch (err) {
    throw new Error(`Data folder "${config.dataDir}" is not writable: ${err.message}`);
  }

  for (const [name, defaults] of Object.entries(COLLECTION_DEFS)) {
    const collection = new Collection(name, config.dataDir, defaults);
    await collection.init();
    collections[name] = collection;
  }
  for (const [name, defaults] of Object.entries(SINGLETON_DEFS)) {
    const singleton = new Singleton(name, config.dataDir, defaults);
    await singleton.init();
    singletons[name] = singleton;
  }

  initialized = true;
  return collections;
}

export async function dataFolderStatus() {
  const entries = await fs.readdir(config.dataDir, { withFileTypes: true });
  const files = [];
  for (const entry of entries) {
    if (entry.isFile() && entry.name.endsWith('.json')) {
      const stat = await fs.stat(path.join(config.dataDir, entry.name));
      files.push({ name: entry.name, size: stat.size, modified: stat.mtime.toISOString() });
    }
  }
  files.sort((a, b) => a.name.localeCompare(b.name));
  return { dataDir: config.dataDir, files };
}

/** Next number for a counter (used for project codes) - locked against other PCs. */
export async function nextCounter(key) {
  return singletons.counters.transaction((counters) => {
    counters[key] = (Number(counters[key]) || 0) + 1;
    return counters[key];
  });
}

export async function readSettings() {
  const settings = await singletons.settings.get();
  return { ...settings };
}

export async function writeSettings(patch) {
  return singletons.settings.update(patch);
}

/** Wipe + rewrite every data file with the given empty defaults (used by reseed). */
export async function resetAllFiles() {
  for (const [name, defaults] of Object.entries(COLLECTION_DEFS)) {
    await writeJsonAtomic(path.join(config.dataDir, `${name}.json`), defaults);
  }
  for (const [name, defaults] of Object.entries(SINGLETON_DEFS)) {
    await writeJsonAtomic(path.join(config.dataDir, `${name}.json`), defaults);
  }
}

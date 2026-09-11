// A Collection is one JSON file (e.g. tasks.json) holding an array of documents.
//
// All writes go through `transaction()`:
//   lock the file -> read the FRESH content from disk -> apply changes -> atomic write
// This guarantees that concurrent edits from multiple PCs never overwrite each other.
import fs from 'node:fs/promises';
import path from 'node:path';
import { readJson, writeJsonAtomic, fileExists } from './jsonFile.js';
import { withLock } from './lock.js';
import { newId, nowIso } from '../utils.js';

function matches(doc, query) {
  return Object.entries(query).every(([key, expected]) => {
    if (expected === undefined || expected === null || expected === '') return true;
    const actual = doc[key];
    if (Array.isArray(expected)) return expected.includes(actual);
    return String(actual) === String(expected);
  });
}

export class Collection {
  constructor(name, dir, defaults = []) {
    this.name = name;
    this.filePath = path.join(dir, `${name}.json`);
    this.defaults = defaults;
  }

  /** Create the file with defaults if it does not exist yet. */
  async init() {
    if (!(await fileExists(this.filePath))) {
      await writeJsonAtomic(this.filePath, this.defaults);
    }
  }

  /** Read everything (no lock: atomic writes guarantee a consistent snapshot). */
  async all() {
    return readJson(this.filePath, this.defaults);
  }

  /** Find docs by object query (shallow equality) or predicate function. */
  async find(query) {
    const rows = await this.all();
    if (typeof query === 'function') return rows.filter(query);
    if (!query) return rows;
    return rows.filter((doc) => matches(doc, query));
  }

  async getById(id) {
    if (!id) return null;
    const rows = await this.all();
    return rows.find((doc) => doc.id === id) || null;
  }

  /**
   * Read-modify-write inside a cross-PC lock.
   * `fn(rows)` receives the live array; mutate it freely.
   * Its return value is passed back to the caller. If `fn` throws, nothing is written.
   */
  async transaction(fn) {
    const filePath = this.filePath;
    const defaults = this.defaults;
    return withLock(filePath, async () => {
      const rows = await readJson(filePath, defaults);
      const result = await fn(rows);
      await writeJsonAtomic(filePath, rows);
      return result;
    });
  }

  /** Insert one document (adds id/createdAt when missing). */
  async insert(doc) {
    const full = {
      id: doc.id || newId(this.name.replace(/s$/, '')),
      createdAt: nowIso(),
      ...doc
    };
    await this.transaction((rows) => {
      rows.push(full);
    });
    return full;
  }

  /** Insert many documents at once (single lock + single write). Returns full docs. */
  async insertMany(docs) {
    const full = docs.map((doc) => ({
      id: doc.id || newId(this.name.replace(/s$/, '')),
      createdAt: nowIso(),
      ...doc
    }));
    await this.transaction((rows) => {
      rows.push(...full);
    });
    return full;
  }

  /**
   * Patch one document. Returns { before, after } or null when not found.
   */
  async update(id, patch) {
    return this.transaction((rows) => {
      const index = rows.findIndex((doc) => doc.id === id);
      if (index === -1) return null;
      const before = { ...rows[index] };
      rows[index] = { ...rows[index], ...patch, updatedAt: nowIso() };
      return { before, after: { ...rows[index] } };
    });
  }

  /** Remove one document. Returns the removed doc or null. */
  async remove(id) {
    return this.transaction((rows) => {
      const index = rows.findIndex((doc) => doc.id === id);
      if (index === -1) return null;
      const [removed] = rows.splice(index, 1);
      return removed;
    });
  }

  /** Remove all documents matching the query. Returns removed docs. */
  async removeWhere(query) {
    return this.transaction((rows) => {
      const removed = [];
      for (let i = rows.length - 1; i >= 0; i -= 1) {
        if (matches(rows[i], query)) removed.push(rows.splice(i, 1)[0]);
      }
      return removed;
    });
  }
}

/** Read a single-document file (settings style). */
export class Singleton {
  constructor(name, dir, defaults = {}) {
    this.name = name;
    this.filePath = path.join(dir, `${name}.json`);
    this.defaults = defaults;
  }

  async init() {
    if (!(await fileExists(this.filePath))) {
      await writeJsonAtomic(this.filePath, this.defaults);
    }
  }

  async get() {
    return readJson(this.filePath, this.defaults);
  }

  async update(patch) {
    return this.transaction((doc) => {
      Object.assign(doc, patch);
      return { ...doc };
    });
  }

  async transaction(fn) {
    const filePath = this.filePath;
    const defaults = this.defaults;
    return withLock(filePath, async () => {
      const doc = await readJson(filePath, defaults);
      const result = await fn(doc);
      await writeJsonAtomic(filePath, doc);
      return result;
    });
  }
}

export { fs };

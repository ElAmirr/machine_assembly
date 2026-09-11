import crypto from 'node:crypto';

/** Generate a short unique id with a readable prefix, e.g. task_3f9c1a... */
export function newId(prefix = 'id') {
  return `${prefix}_${crypto.randomUUID().replace(/-/g, '').slice(0, 16)}`;
}

export function nowIso() {
  return new Date().toISOString();
}

/** HTTP error with a status code that the error middleware understands. */
export class ApiError extends Error {
  constructor(status, message, details) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export const badRequest = (msg, details) => new ApiError(400, msg, details);
export const unauthorized = (msg = 'Authentication required') => new ApiError(401, msg);
export const forbidden = (msg = 'You do not have permission to do this') => new ApiError(403, msg);
export const notFound = (msg = 'Not found') => new ApiError(404, msg);
export const conflict = (msg) => new ApiError(409, msg);

/** Wrap async route handlers so thrown errors reach the error middleware. */
export function asyncHandler(fn) {
  return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

/** Trim a value to a string (or return fallback). */
export function str(value, fallback = '') {
  if (value === undefined || value === null) return fallback;
  return String(value).trim();
}

/** Trim a value to a string or null when empty. */
export function strOrNull(value) {
  const s = str(value);
  return s === '' ? null : s;
}

export function toNum(value, fallback = null) {
  if (value === undefined || value === null || value === '') return fallback;
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

export function toBool(value, fallback = false) {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value === 'boolean') return value;
  return ['true', '1', 'yes', 'on'].includes(String(value).toLowerCase());
}

/** Pick only the given keys from an object (undefined keys are dropped). */
export function pick(obj, keys) {
  const out = {};
  for (const key of keys) {
    if (obj[key] !== undefined) out[key] = obj[key];
  }
  return out;
}

/** Keep only unique, non-empty strings from an array. */
export function idArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((v) => str(v)).filter(Boolean))];
}

function unitToMs(unit) {
  switch (unit) {
    case 'minutes': return 60 * 1000;
    case 'hours': return 60 * 60 * 1000;
    default: return 24 * 60 * 60 * 1000; // days
  }
}

/** Add a duration (minutes/hours/days) to a date, returns ISO string. */
export function addDuration(dateIso, amount, unit) {
  const base = dateIso ? new Date(dateIso).getTime() : Date.now();
  return new Date(base + (Number(amount) || 0) * unitToMs(unit)).toISOString();
}

/** Convert a duration to days (used for progress weighting). */
export function durationToDays(amount, unit) {
  const n = Number(amount) || 0;
  if (unit === 'minutes') return n / 1440;
  if (unit === 'hours') return n / 24;
  return n;
}

export function daysBetween(startIso, endIso) {
  if (!startIso || !endIso) return null;
  return Math.round(((new Date(endIso) - new Date(startIso)) / (24 * 60 * 60 * 1000)) * 10) / 10;
}

/** Build CSV text from an array of objects and column definitions. */
export function toCsv(rows, columns) {
  const esc = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n;]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const header = columns.map((c) => esc(c.label)).join(',');
  const lines = rows.map((row) => columns.map((c) => esc(typeof c.value === 'function' ? c.value(row) : row[c.key])).join(','));
  return '\uFEFF' + [header, ...lines].join('\r\n');
}

/** Format a date (yyyy-mm-dd) as DD/MM/YYYY for reports. */
export function fmtDate(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (n) => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}`;
}

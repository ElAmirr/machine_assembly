// Small formatting / date helpers shared by all client pages.

export function fmtDate(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: '2-digit' });
}

export function fmtDateTime(value) {
  if (!value) return '—';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString(undefined, { year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

export function fmtRelative(value) {
  if (!value) return '';
  const diff = Date.now() - new Date(value).getTime();
  const abs = Math.abs(diff);
  const mins = Math.round(abs / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return diff > 0 ? `${mins} min ago` : `in ${mins} min`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return diff > 0 ? `${hours} h ago` : `in ${hours} h`;
  const days = Math.round(hours / 24);
  if (days < 31) return diff > 0 ? `${days} d ago` : `in ${days} d`;
  return fmtDate(value);
}

export function fmtBytes(bytes) {
  const n = Number(bytes) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

export function toDateInput(value) {
  if (!value) return '';
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return '';
  const pad = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export function daysUntil(value) {
  if (!value) return null;
  return Math.ceil((new Date(value).getTime() - Date.now()) / (24 * 3600 * 1000));
}

export function dueLabel(value) {
  const days = daysUntil(value);
  if (days === null) return '';
  if (days < 0) return `${Math.abs(days)} d overdue`;
  if (days === 0) return 'due today';
  if (days === 1) return 'due tomorrow';
  return `due in ${days} d`;
}

export function initials(name) {
  const parts = String(name || '?').trim().split(/\s+/);
  return ((parts[0]?.[0] || '?') + (parts[1]?.[0] || '')).toUpperCase();
}

export function classNames(...args) {
  return args.filter(Boolean).join(' ');
}

/** Status key -> badge tone (shared by project/task/step statuses). */
export function statusTone(status) {
  switch (status) {
    case 'completed': case 'approved': case 'available': case 'active': return 'badge-green';
    case 'in_progress': return 'badge-blue';
    case 'ready': return 'badge-cyan';
    case 'submitted': case 'validation': return 'badge-purple';
    case 'rejected': case 'blocked': return 'badge-red';
    case 'waiting': return 'badge-amber';
    case 'cancelled': case 'inactive': return 'badge-slate';
    default: return 'badge-slate';
  }
}

export function priorityTone(priority) {
  switch (priority) {
    case 'critical': return 'badge-red';
    case 'high': return 'badge-amber';
    case 'medium': return 'badge-blue';
    default: return 'badge-slate';
  }
}

export function durationText(value, unit) {
  if (!value && value !== 0) return '';
  return `${value} ${unit || 'days'}`;
}

/** Build a lookup Map id -> row for quick joins in pages. */
export function byId(rows) {
  return new Map((rows || []).map((r) => [r.id, r]));
}

export function dayKey(value) {
  return value ? String(value).slice(0, 10) : '';
}

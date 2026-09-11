// Shared UI primitives: icons, modal, badges, progress, tabs, form helpers.
import { useEffect, useRef, useState } from 'react';
import { classNames, initials, statusTone } from '../utils.js';
import { api } from '../api.js';

// ------------------------------------------------------------------ icons
const ICONS = {
  dashboard: 'M3 3h7v9H3zM14 3h7v5h-7zM14 12h7v9h-7zM3 16h7v5H3z',
  projects: 'M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z',
  tasks: 'M9 6h11M9 12h11M9 18h11M4 6h1M4 12h1M4 18h1',
  check: 'M20 6 9 17l-5-5',
  checkCircle: 'M22 11.1V12a10 10 0 1 1-5.9-9.1M22 4 12 14.01l-3-3',
  clock: 'M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20M12 6v6l4 2',
  calendar: 'M8 2v4M16 2v4M3 10h18M5 4h14a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2z',
  planning: 'M3 3v18h18M7 16v-5M12 16V8M17 16v-3',
  workflow: 'M5 3a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zM5 15a2 2 0 0 0-2 2v2a2 2 0 0 0 2 2h2a2 2 0 0 0 2-2v-2a2 2 0 0 0-2-2zM19 9a2 2 0 0 0-2 2v1a2 2 0 0 0 2 2h1V9zM7 9v6M9 12h6a2 2 0 0 0 2-2V9',
  materials: 'M21 8 12 3 3 8v8l9 5 9-5zM3 8l9 5 9-5M12 13v8',
  components: 'M7 7h10v10H7zM3 3h4v4H3zM17 3h4v4h-4zM3 17h4v4H3zM17 17h4v4h-4z',
  tools: 'M14.7 6.3a4.5 4.5 0 0 0-6 6L3 18l3 3 5.7-5.7a4.5 4.5 0 0 0 6-6L14 13l-3-3z',
  people: 'M17 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M9.5 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8M23 21v-2a4 4 0 0 0-3-3.9M16 3.1a4 4 0 0 1 0 7.8',
  roles: 'M12 2 3 6v6c0 5 4 8.4 9 10 5-1.6 9-5 9-10V6z',
  reports: 'M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8zM14 2v6h6M9 15h6M9 11h2',
  approvals: 'M9 11l3 3L22 4M21 12v7a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11',
  bell: 'M18 8a6 6 0 1 0-12 0c0 7-3 9-3 9h18s-3-2-3-9M13.7 21a2 2 0 0 1-3.4 0',
  audit: 'M12 8v4l3 2M12 22a10 10 0 1 0 0-20 10 10 0 0 0 0 20',
  admin: 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.9 2.9l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.5 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.9-2.9l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.5-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.9-2.9l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.5 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.9 2.9l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1z',
  machines: 'M2 20h20M4 20V8l6-4v16M10 20V4l10 4v12M14 12h1M14 16h1M6.5 12h1M6.5 16h1',
  search: 'M11 19a8 8 0 1 0 0-16 8 8 0 0 0 0 16M21 21l-4.3-4.3',
  plus: 'M12 5v14M5 12h14',
  logout: 'M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4M16 17l5-5-5-5M21 12H9',
  user: 'M20 21v-2a4 4 0 0 0-4-4H8a4 4 0 0 0-4 4v2M12 11a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  upload: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12',
  download: 'M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3',
  trash: 'M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6M10 11v6M14 11v6',
  edit: 'M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7M18.5 2.5a2.1 2.1 0 1 1 3 3L12 15l-4 1 1-4z',
  x: 'M18 6 6 18M6 6l12 12',
  alert: 'M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0M12 9v4M12 17h.01',
  back: 'M19 12H5M12 19l-7-7 7-7',
  chevronRight: 'm9 18 6-6-6-6',
  chevronDown: 'm6 9 6 6 6-6',
  menu: 'M4 6h16M4 12h16M4 18h16',
  file: 'M13 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V9zM13 2v7h7',
  camera: 'M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2zM12 17a4 4 0 1 0 0-8 4 4 0 0 0 0 8',
  comment: 'M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z',
  play: 'm5 3 14 9-14 9z',
  flag: 'M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1zM4 22v-7',
  refresh: 'M23 4v6h-6M1 20v-6h6M3.5 9a9 9 0 0 1 14.9-3.4L23 10M1 14l4.6 4.4A9 9 0 0 0 20.5 15',
  eye: 'M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6',
  list: 'M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01',
  folder: 'M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z'
};

export function Icon({ name, size = 17, className, ...rest }) {
  const d = ICONS[name] || ICONS.file;
  return (
    <svg
      width={size} height={size} viewBox="0 0 24 24" fill="none"
      stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
      className={className} aria-hidden="true" {...rest}
    >
      <path d={d} />
    </svg>
  );
}

// ------------------------------------------------------------------ layout helpers
export function PageHeader({ title, subtitle, children, backTo }) {
  return (
    <div className="page-header">
      <div className="grow">
        {backTo}
        <h1>{title}</h1>
        {subtitle ? <div className="sub">{subtitle}</div> : null}
      </div>
      <div className="flex flex-wrap">{children}</div>
    </div>
  );
}

export function Card({ title, actions, children, className, bodyClass = 'card-body' }) {
  return (
    <div className={classNames('card', className)}>
      {title || actions ? (
        <div className="card-header">
          <h3 className="grow">{title}</h3>
          {actions}
        </div>
      ) : null}
      {children ? <div className={bodyClass}>{children}</div> : null}
    </div>
  );
}

export function Loading({ label = 'Loading…' }) {
  return (
    <div className="loading-block">
      <span className="spinner" />
      <span>{label}</span>
    </div>
  );
}

export function ErrorBlock({ message }) {
  if (!message) return null;
  return <div className="error-block">{message}</div>;
}

export function Empty({ icon = 'folder', title = 'Nothing here yet', hint }) {
  return (
    <div className="empty">
      <div><Icon name={icon} size={30} /></div>
      <div className="strong">{title}</div>
      {hint ? <div className="small mt-8">{hint}</div> : null}
    </div>
  );
}

// ------------------------------------------------------------------ badges
export function StatusBadge({ status, kind = 'task', label }) {
  return (
    <span className={classNames('badge', statusTone(status))}>
      <span className="badge-dot" />{label || status || '—'}
    </span>
  );
}

export function PriorityBadge({ priority, label }) {
  const tones = { critical: 'badge-red', high: 'badge-amber', medium: 'badge-blue', low: 'badge-slate' };
  return <span className={classNames('badge', tones[priority] || 'badge-slate')}>{label || priority || '—'}</span>;
}

// ------------------------------------------------------------------ progress
export function ProgressBar({ value, variant = '', showLabel = false }) {
  const v = Math.max(0, Math.min(100, Math.round(Number(value) || 0)));
  const cls = variant || (v >= 100 ? 'done' : '');
  return (
    <div>
      {showLabel ? (
        <div className="progress-label"><span>Progress</span><span>{v}%</span></div>
      ) : null}
      <div className="progress" role="progressbar" aria-valuenow={v} aria-valuemin="0" aria-valuemax="100">
        <div className={classNames('progress-bar', cls)} style={{ width: `${v}%` }} />
      </div>
    </div>
  );
}

export function Avatar({ name, large }) {
  return <span className={classNames('avatar', large && 'avatar-lg')}>{initials(name)}</span>;
}

// ------------------------------------------------------------------ modal
export function Modal({ title, children, footer, onClose, size = '', width }) {
  useEffect(() => {
    const onKey = (e) => { if (e.key === 'Escape') onClose?.(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <div className="modal-backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose?.(); }}>
      <div className={classNames('modal', size)} style={width ? { maxWidth: width } : undefined}>
        <div className="modal-header">
          <h3>{title}</h3>
          <button type="button" className="icon-btn" onClick={onClose} aria-label="Close"><Icon name="x" /></button>
        </div>
        <div className="modal-body">{children}</div>
        {footer ? <div className="modal-footer">{footer}</div> : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ tabs
export function Tabs({ tabs, active, onChange }) {
  return (
    <div className="tabs">
      {tabs.map((tab) => (
        <button
          key={tab.key}
          type="button"
          className={classNames('tab', tab.key === active && 'active')}
          onClick={() => onChange(tab.key)}
        >
          {tab.label}
          {tab.count !== undefined ? <span className="count">{tab.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ form field wrapper
export function Field({ label, hint, error, children, className }) {
  return (
    <div className={classNames('field', className)}>
      {label ? <label>{label}</label> : null}
      {children}
      {hint ? <div className="hint">{hint}</div> : null}
      {error ? <div className="error">{error}</div> : null}
    </div>
  );
}

// ------------------------------------------------------------------ attachment image with auth
export function AuthImage({ attachmentId, alt, className }) {
  const [failed, setFailed] = useState(false);
  if (failed) return <Icon name="file" />;
  return (
    <img
      src={api.fileUrl(attachmentId, true)}
      alt={alt || 'file'}
      className={className}
      onError={() => setFailed(true)}
    />
  );
}

// ------------------------------------------------------------------ inline search input
export function SearchInput({ value, onChange, placeholder = 'Search…', autoFocus }) {
  return (
    <div className="search-input-wrap grow">
      <Icon name="search" size={15} />
      <input
        className="input"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
      />
    </div>
  );
}

// ------------------------------------------------------------------ multi select (roles etc.)
export function MultiSelect({ options, value = [], onChange, placeholder = 'Select…' }) {
  const [open, setOpen] = useState(false);
  const ref = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (ref.current && !ref.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const toggle = (id) => {
    const next = value.includes(id) ? value.filter((v) => v !== id) : [...value, id];
    onChange(next);
  };

  const selected = options.filter((o) => value.includes(o.id));
  return (
    <div ref={ref} style={{ position: 'relative' }}>
      <button type="button" className="input" style={{ textAlign: 'left', cursor: 'pointer' }} onClick={() => setOpen(!open)}>
        {selected.length === 0 ? <span className="muted">{placeholder}</span> : selected.map((s) => s.name || s.label).join(', ')}
      </button>
      {open ? (
        <div className="search-results" style={{ position: 'absolute', minWidth: '100%' }}>
          {options.map((o) => (
            <label key={o.id} className="search-item" style={{ cursor: 'pointer' }}>
              <input type="checkbox" checked={value.includes(o.id)} onChange={() => toggle(o.id)} />
              <span>{o.name || o.label}</span>
            </label>
          ))}
          {options.length === 0 ? <div className="empty small">No options</div> : null}
        </div>
      ) : null}
    </div>
  );
}

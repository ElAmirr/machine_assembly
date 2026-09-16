// App shell: dark sidebar, topbar with global search + notification bell.
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext.jsx';
import { api } from '../api.js';
import { Icon, Avatar } from './ui.jsx';
import { fmtRelative } from '../utils.js';

function NavItem({ to, icon, label, badge, onClick }) {
  return (
    <NavLink to={to} end={to === '/'} className={({ isActive }) => `nav-item${isActive ? ' active' : ''}`} onClick={onClick}>
      <Icon name={icon} size={16} />
      <span>{label}</span>
      {badge ? <span className="nav-badge">{badge}</span> : null}
    </NavLink>
  );
}

function GlobalSearch() {
  const [term, setTerm] = useState('');
  const [results, setResults] = useState(null);
  const [open, setOpen] = useState(false);
  const navigate = useNavigate();
  const boxRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  useEffect(() => {
    if (term.trim().length < 2) { setResults(null); return undefined; }
    const timer = setTimeout(async () => {
      try {
        const data = await api.get(`/search?q=${encodeURIComponent(term.trim())}`);
        setResults(data);
        setOpen(true);
      } catch { /* ignore */ }
    }, 260);
    return () => clearTimeout(timer);
  }, [term]);

  const go = (path) => {
    setOpen(false);
    setTerm('');
    navigate(path);
  };

  const hasAny = results && (results.projects.length + results.tasks.length + results.machines.length + results.people.length) > 0;

  return (
    <div className="search-input-wrap" ref={boxRef} style={{ maxWidth: 330 }}>
      <Icon name="search" size={15} />
      <input
        className="input"
        placeholder="Search projects, machines, tasks…"
        value={term}
        onChange={(e) => setTerm(e.target.value)}
        onFocus={() => results && setOpen(true)}
      />
      {open && results ? (
        <div className="search-results">
          {!hasAny ? <div className="empty small">No results</div> : null}
          {results.projects.length > 0 ? <div className="search-group-title">Projects</div> : null}
          {results.projects.map((p) => (
            <div key={p.id} className="search-item" onClick={() => go(`/projects/${p.id}`)}>
              <Icon name="projects" size={14} />
              <span className="strong">{p.machineName}</span>
              <span className="muted small">{p.code} · {p.status}</span>
            </div>
          ))}
          {results.tasks.length > 0 ? <div className="search-group-title">Tasks</div> : null}
          {results.tasks.map((t) => (
            <div key={t.id} className="search-item" onClick={() => go(`/tasks/${t.id}`)}>
              <Icon name="tasks" size={14} />
              <span>{t.name}</span>
              <span className="muted small">{t.machineName}</span>
            </div>
          ))}
          {results.machines.length > 0 ? <div className="search-group-title">Machines</div> : null}
          {results.machines.map((m) => (
            <div key={m.machineName + m.machineReference} className="search-item" onClick={() => go(`/machines?q=${encodeURIComponent(m.machineName)}`)}>
              <Icon name="machines" size={14} />
              <span>{m.machineName}</span>
              <span className="muted small">{m.projects} project(s)</span>
            </div>
          ))}
          {results.people.length > 0 ? <div className="search-group-title">People</div> : null}
          {results.people.map((u) => (
            <div key={u.id} className="search-item" onClick={() => go(`/people?q=${encodeURIComponent(u.username)}`)}>
              <Icon name="user" size={14} />
              <span>{u.name}</span>
              <span className="muted small">@{u.username}</span>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function NotificationsBell({ onCountChange }) {
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState([]);
  const boxRef = useRef(null);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      const data = await api.get('/notifications?limit=30');
      setRows(data);
      onCountChange(data.filter((n) => !n.read).length);
    } catch { /* ignore */ }
  }, [onCountChange]);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60000);
    return () => clearInterval(timer);
  }, [load]);

  useEffect(() => {
    const onClick = (e) => { if (boxRef.current && !boxRef.current.contains(e.target)) setOpen(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const openItem = async (n) => {
    setOpen(false);
    if (!n.read) {
      try { await api.post(`/notifications/${n.id}/read`); } catch { /* ignore */ }
      load();
    }
    if (n.link) navigate(n.link);
  };

  const markAll = async () => {
    try { await api.post('/notifications/read-all'); } catch { /* ignore */ }
    load();
  };

  const unread = rows.filter((n) => !n.read).length;

  return (
    <div ref={boxRef} style={{ position: 'relative' }}>
      <button type="button" className="icon-btn" onClick={() => { setOpen(!open); if (!open) load(); }} aria-label="Notifications" style={{ position: 'relative' }}>
        <Icon name="bell" size={19} />
        {unread > 0 ? (
          <span style={{
            position: 'absolute', top: 0, right: -1, background: 'var(--red)', color: '#fff',
            borderRadius: 9, fontSize: 10, fontWeight: 700, padding: '1px 5px', lineHeight: 1.4
          }}>
            {unread > 99 ? '99+' : unread}
          </span>
        ) : null}
      </button>
      {open ? (
        <div className="notif-panel">
          <div className="head">
            <strong className="grow">Notifications</strong>
            <button type="button" className="btn btn-ghost btn-sm" onClick={markAll}>Mark all read</button>
          </div>
          <div className="notif-list">
            {rows.length === 0 ? <div className="empty small">No notifications</div> : null}
            {rows.map((n) => (
              <div key={n.id} className={`notif-item${n.read ? '' : ' unread'}`} onClick={() => openItem(n)}>
                <div className="t">{n.title}</div>
                <div className="m">{n.message}</div>
                <div className="d">{fmtRelative(n.createdAt)}</div>
              </div>
            ))}
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default function Layout() {
  const { user, hasPermission, logout } = useAuth();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [userMenu, setUserMenu] = useState(false);
  const [unread, setUnread] = useState(0);
  const navigate = useNavigate();
  const userBoxRef = useRef(null);

  useEffect(() => {
    const onClick = (e) => { if (userBoxRef.current && !userBoxRef.current.contains(e.target)) setUserMenu(false); };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, []);

  const close = () => setSidebarOpen(false);
  const fullName = `${user?.firstName || ''} ${user?.lastName || ''}`.trim() || user?.username || '';
  const roleNames = (user?.roles || []).map((r) => r.name).join(', ');

  return (
    <div className="app">
      <div className={`sidebar-backdrop${sidebarOpen ? ' show' : ''}`} onClick={close} />
      <aside className={`sidebar${sidebarOpen ? ' open' : ''}`}>
        <div className="sidebar-brand">
          <span className="brand-logo">
            <Icon name="tools" size={19} className="white" />
          </span>
          <div>
            <b>Machine Assembly</b>
            <small>Management System</small>
          </div>
        </div>
        <nav className="sidebar-nav">
          <div className="nav-section">Overview</div>
          {hasPermission('projects.view') ? <NavItem to="/" icon="dashboard" label="Dashboard" onClick={close} /> : null}
          {hasPermission('tasks.view') ? <NavItem to="/my-tasks" icon="checkCircle" label="My Work" onClick={close} /> : null}
          {hasPermission('approvals.approve') ? <NavItem to="/approvals" icon="approvals" label="Approvals" onClick={close} /> : null}

          {hasPermission('projects.view') ? <div className="nav-section">Operations</div> : null}
          {hasPermission('projects.view') ? <NavItem to="/projects" icon="projects" label="Projects" onClick={close} /> : null}
          {hasPermission('tasks.view') ? <NavItem to="/tasks" icon="tasks" label="Tasks" onClick={close} /> : null}
          {hasPermission('projects.view') ? <NavItem to="/planning" icon="planning" label="Planning" onClick={close} /> : null}
          {hasPermission('projects.view') ? <NavItem to="/machines" icon="machines" label="Machines" onClick={close} /> : null}

          {hasPermission(['workflow.view', 'components.view', 'tools.view']) ? <div className="nav-section">Engineering</div> : null}
          {hasPermission('workflow.view') ? <NavItem to="/workflows" icon="workflow" label="Workflows" onClick={close} /> : null}
          {hasPermission('components.view') ? <NavItem to="/components" icon="components" label="Components" onClick={close} /> : null}
          {hasPermission('tools.view') ? <NavItem to="/tools" icon="tools" label="Tools" onClick={close} /> : null}

          {hasPermission(['users.view', 'roles.view', 'reports.view', 'audit_logs.view', 'settings.manage', 'config.manage']) ? <div className="nav-section">Administration</div> : null}
          {hasPermission('users.view') ? <NavItem to="/people" icon="people" label="People" onClick={close} /> : null}
          {hasPermission('roles.view') ? <NavItem to="/roles" icon="roles" label="Roles" onClick={close} /> : null}
          {hasPermission('reports.view') ? <NavItem to="/reports" icon="reports" label="Reports" onClick={close} /> : null}
          {hasPermission('audit_logs.view') ? <NavItem to="/audit" icon="audit" label="Audit Log" onClick={close} /> : null}
          {hasPermission(['settings.manage', 'config.manage']) ? <NavItem to="/administration" icon="admin" label="Administration" onClick={close} /> : null}
        </nav>
      </aside>

      <div className="main">
        <header className="topbar">
          <button type="button" className="icon-btn mobile-menu" onClick={() => setSidebarOpen(true)} aria-label="Menu">
            <Icon name="menu" size={20} />
          </button>
          <GlobalSearch />
          <div className="grow" />
          <NotificationsBell onCountChange={setUnread} />
          <div ref={userBoxRef} style={{ position: 'relative' }}>
            <button type="button" className="btn btn-ghost" onClick={() => setUserMenu(!userMenu)}>
              <Avatar name={fullName} />
              <span className="nowrap" style={{ maxWidth: 130, overflow: 'hidden', textOverflow: 'ellipsis' }}>{fullName}</span>
              <Icon name="chevronDown" size={14} />
            </button>
            {userMenu ? (
              <div className="search-results" style={{ right: 0, left: 'auto', minWidth: 230 }}>
                <div style={{ padding: '12px 14px 8px', borderBottom: '1px solid var(--border)' }}>
                  <div className="strong">{fullName}</div>
                  <div className="small muted">{roleNames || 'No role'}</div>
                </div>
                <div className="search-item" onClick={() => { setUserMenu(false); navigate('/profile'); }}>
                  <Icon name="user" size={15} /> My profile
                </div>
                {hasPermission('tasks.view') ? (
                  <div className="search-item" onClick={() => { setUserMenu(false); navigate('/notifications'); }}>
                    <Icon name="bell" size={15} /> Notifications {unread > 0 ? <span className="badge badge-red">{unread}</span> : null}
                  </div>
                ) : null}
                <div className="search-item" style={{ color: 'var(--red)' }} onClick={async () => { setUserMenu(false); await logout(); navigate('/login'); }}>
                  <Icon name="logout" size={15} /> Sign out
                </div>
              </div>
            ) : null}
          </div>
        </header>
        <main className="content">
          <Outlet />
        </main>
      </div>
    </div>
  );
}

export { Link };

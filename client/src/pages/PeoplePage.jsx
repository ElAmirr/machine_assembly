// People management: users, roles, password reset, work history (spec sections 29-32).
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Card, Icon, Loading, ErrorBlock, Empty, Modal, Field, MultiSelect, Avatar, StatusBadge } from '../components/ui.jsx';
import { fmtDateTime, fmtDate } from '../utils.js';

function UserModal({ user, roles, departments, onClose, onSaved }) {
  const { show } = useToast();
  const editing = !!user;
  const [form, setForm] = useState(() => ({
    firstName: user?.firstName || '',
    lastName: user?.lastName || '',
    username: user?.username || '',
    email: user?.email || '',
    phone: user?.phone || '',
    roleIds: user?.roleIds || [],
    departmentId: user?.departmentId || '',
    active: user?.active !== false,
    password: ''
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    if (!form.firstName.trim()) { setError('First name is required.'); return; }
    if (!form.username.trim()) { setError('Username is required.'); return; }
    if (!editing && form.password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (editing && form.password && form.password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    if (form.roleIds.length === 0) { setError('Select at least one role.'); return; }
    setBusy(true);
    try {
      const payload = {
        firstName: form.firstName.trim(),
        lastName: form.lastName,
        username: form.username.trim(),
        email: form.email,
        phone: form.phone,
        roleIds: form.roleIds,
        departmentId: form.departmentId || null,
        active: form.active
      };
      if (form.password) payload.password = form.password;
      if (editing) await api.put(`/users/${user.id}`, payload);
      else await api.post('/users', payload);
      show(editing ? 'User updated' : 'User created', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={editing ? `Edit ${user.username}` : 'New user'}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="user-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create user'}
          </button>
        </>
      )}
    >
      <form id="user-form" onSubmit={submit}>
        {error ? <div className="error-block">{error}</div> : null}
        <div className="inline-fields">
          <Field label="First name *">
            <input className="input" value={form.firstName} onChange={set('firstName')} />
          </Field>
          <Field label="Last name">
            <input className="input" value={form.lastName} onChange={set('lastName')} />
          </Field>
        </div>
        <div className="inline-fields">
          <Field label="Username *">
            <input className="input" value={form.username} onChange={set('username')} autoComplete="off" />
          </Field>
          <Field label={editing ? 'New password (leave empty to keep)' : 'Password *'}>
            <input type="password" className="input" value={form.password} onChange={set('password')} autoComplete="new-password" />
          </Field>
        </div>
        <div className="inline-fields">
          <Field label="Email">
            <input type="email" className="input" value={form.email} onChange={set('email')} />
          </Field>
          <Field label="Phone">
            <input className="input" value={form.phone} onChange={set('phone')} />
          </Field>
        </div>
        <Field label="Roles *" hint="Permissions are the union of all roles.">
          <MultiSelect
            options={roles.map((r) => ({ id: r.id, name: r.name }))}
            value={form.roleIds}
            onChange={(ids) => setForm((f) => ({ ...f, roleIds: ids }))}
            placeholder="Select roles…"
          />
        </Field>
        <Field label="Department">
          <select className="select" value={form.departmentId} onChange={set('departmentId')}>
            <option value="">— None —</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
        </Field>
        <label className="checkbox-row">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
          Account is active (can log in)
        </label>
      </form>
    </Modal>
  );
}

function ResetPasswordModal({ user, onClose, onSaved }) {
  const { show } = useToast();
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (password.length < 6) { setError('Password must be at least 6 characters.'); return; }
    setBusy(true);
    try {
      await api.post(`/users/${user.id}/reset-password`, { newPassword: password });
      show('Password reset', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={`Reset password — ${user.username}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="reset-form" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Reset password'}</button>
        </>
      )}
    >
      <form id="reset-form" onSubmit={submit}>
        {error ? <div className="error-block">{error}</div> : null}
        <p className="small muted">The user will use this new password at the next login.</p>
        <Field label="New password *">
          <input type="password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoFocus autoComplete="new-password" />
        </Field>
      </form>
    </Modal>
  );
}

function UserWorkModal({ user, onClose }) {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.get(`/users/${user.id}/tasks`).then(setData).catch((err) => setError(err.message));
  }, [user.id]);

  return (
    <Modal title={`Work of ${user.firstName} ${user.lastName}`} onClose={onClose} size="modal-lg"
      footer={<button type="button" className="btn btn-secondary" onClick={onClose}>Close</button>}
    >
      {error ? <ErrorBlock message={error} /> : null}
      {!data ? <Loading /> : (
        <div>
          <div className="strong mb-8">Currently assigned tasks ({data.assigned?.length || 0})</div>
          {data.assigned?.length === 0 ? <div className="small muted mb-16">No open tasks.</div> : (
            <table className="table mb-16">
              <thead><tr><th>Task</th><th>Machine</th><th>Status</th><th>Planned end</th></tr></thead>
              <tbody>
                {data.assigned.map((t) => (
                  <tr key={t.id}>
                    <td className="strong">{t.name}</td>
                    <td className="muted">{t.projectCode} {t.machineName}</td>
                    <td><StatusBadge status={t.status} /></td>
                    <td className="small muted">{fmtDate(t.plannedEnd)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          <div className="strong mb-8">Completion history ({data.history?.length || 0})</div>
          {data.history?.length === 0 ? <div className="small muted">Nothing completed yet.</div> : (
            <table className="table">
              <thead><tr><th>Step / task</th><th>Machine</th><th>Completed</th></tr></thead>
              <tbody>
                {data.history.slice(0, 50).map((h, i) => (
                  <tr key={i}>
                    <td><span className="strong">{h.stepTitle}</span><div className="small muted">{h.taskName}</div></td>
                    <td className="muted">{h.machineName}</td>
                    <td className="small muted nowrap">{fmtDateTime(h.completedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function PeoplePage() {
  const { user: me, hasPermission } = useAuth();
  const { show, confirm } = useToast();
  const [rows, setRows] = useState(null);
  const [roles, setRoles] = useState([]);
  const [departments, setDepartments] = useState([]);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [roleFilter, setRoleFilter] = useState('');
  const [deptFilter, setDeptFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [editUser, setEditUser] = useState(null);
  const [showNew, setShowNew] = useState(false);
  const [resetUser, setResetUser] = useState(null);
  const [workUser, setWorkUser] = useState(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set('q', q.trim());
      if (roleFilter) qs.set('roleId', roleFilter);
      if (deptFilter) qs.set('departmentId', deptFilter);
      if (statusFilter) qs.set('status', statusFilter);
      const [users, roleRows, deptRows] = await Promise.all([
        api.get(`/users?${qs.toString()}`),
        api.get('/roles').catch(() => []),
        api.get('/departments').catch(() => [])
      ]);
      setRows(users);
      setRoles(roleRows);
      setDepartments(deptRows);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [q, roleFilter, deptFilter, statusFilter]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const canCreate = hasPermission('users.create');
  const canEdit = hasPermission('users.edit');
  const canDelete = hasPermission('users.delete');

  const toggleActive = async (u) => {
    if (u.active === false) {
      try {
        await api.patch(`/users/${u.id}/status`, { active: true });
        show('User activated', 'success');
        load();
      } catch (err) { show(err.message, 'error'); }
      return;
    }
    const ok = await confirm({
      title: `Deactivate ${u.username}?`,
      message: 'The user will no longer be able to log in. Their history stays intact.',
      confirmLabel: 'Deactivate'
    });
    if (!ok) return;
    try {
      await api.patch(`/users/${u.id}/status`, { active: false });
      show('User deactivated', 'success');
      load();
    } catch (err) { show(err.message, 'error'); }
  };

  const remove = async (u) => {
    const ok = await confirm({
      title: `Delete ${u.username}?`,
      message: 'The account is permanently deleted and removed from task assignments. Their completed history stays in the logs.',
      confirmLabel: 'Delete user'
    });
    if (!ok) return;
    try {
      await api.del(`/users/${u.id}`);
      show('User deleted', 'success');
      load();
    } catch (err) { show(err.message, 'error'); }
  };

  return (
    <div>
      <div className="page-header">
        <div className="grow">
          <h1>People</h1>
          <div className="sub">{rows ? `${rows.length} user account(s)` : 'Users, roles and access'}</div>
        </div>
        {canCreate ? (
          <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>
            <Icon name="plus" size={15} /> New user
          </button>
        ) : null}
      </div>

      <Card bodyClass="card-body">
        <div className="toolbar mb-16">
          <div className="search-input-wrap grow">
            <Icon name="search" size={15} />
            <input className="input" placeholder="Search name, username, email…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="select" style={{ width: 170 }} value={roleFilter} onChange={(e) => setRoleFilter(e.target.value)}>
            <option value="">All roles</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select className="select" style={{ width: 180 }} value={deptFilter} onChange={(e) => setDeptFilter(e.target.value)}>
            <option value="">All departments</option>
            {departments.map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
          </select>
          <select className="select" style={{ width: 140 }} value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)}>
            <option value="">All statuses</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>

        {error ? <ErrorBlock message={error} /> : null}
        {!rows ? <Loading /> : rows.length === 0 ? <Empty icon="people" title="No users found" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>User</th>
                  <th>Roles</th>
                  <th>Department</th>
                  <th>Contact</th>
                  <th>Status</th>
                  <th>Last login</th>
                  <th className="actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((u) => {
                  const fullName = `${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username;
                  return (
                    <tr key={u.id}>
                      <td>
                        <div className="flex" style={{ gap: 8 }}>
                          <Avatar name={fullName} />
                          <div>
                            <div className="strong">{fullName} {u.id === me?.id ? <span className="badge badge-blue">you</span> : null}</div>
                            <div className="small muted">@{u.username}</div>
                          </div>
                        </div>
                      </td>
                      <td>
                        <div className="flex flex-wrap" style={{ gap: 4 }}>
                          {(u.roleNames || u.roles || []).map((r) => (
                            <span className="badge badge-slate" key={r.id || r}>{r.name || r}</span>
                          ))}
                        </div>
                      </td>
                      <td className="muted">{u.departmentName || '—'}</td>
                      <td className="small muted">
                        {u.email || '—'}
                        {u.phone ? <div>{u.phone}</div> : null}
                      </td>
                      <td>{u.active === false ? <span className="badge badge-slate">inactive</span> : <span className="badge badge-green">active</span>}</td>
                      <td className="small muted nowrap">{u.lastLogin ? fmtDateTime(u.lastLogin) : 'never'}</td>
                      <td className="actions">
                        <div className="flex" style={{ gap: 2, justifyContent: 'flex-end' }}>
                          <button type="button" className="icon-btn" title="Work history" onClick={() => setWorkUser(u)}><Icon name="clock" size={15} /></button>
                          {canEdit ? (
                            <>
                              <button type="button" className="icon-btn" title="Edit" onClick={() => setEditUser(u)}><Icon name="edit" size={15} /></button>
                              <button type="button" className="icon-btn" title="Reset password" onClick={() => setResetUser(u)}><Icon name="roles" size={15} /></button>
                              <button type="button" className="icon-btn" title={u.active === false ? 'Activate' : 'Deactivate'} onClick={() => toggleActive(u)}>
                                <Icon name={u.active === false ? 'checkCircle' : 'x'} size={15} />
                              </button>
                            </>
                          ) : null}
                          {canDelete && u.id !== me?.id ? (
                            <button type="button" className="icon-btn" title="Delete" onClick={() => remove(u)}><Icon name="trash" size={15} /></button>
                          ) : null}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {showNew ? (
        <UserModal roles={roles} departments={departments} onClose={() => setShowNew(false)} onSaved={load} />
      ) : null}
      {editUser ? (
        <UserModal user={editUser} roles={roles} departments={departments} onClose={() => setEditUser(null)} onSaved={load} />
      ) : null}
      {resetUser ? (
        <ResetPasswordModal user={resetUser} onClose={() => setResetUser(null)} onSaved={load} />
      ) : null}
      {workUser ? (
        <UserWorkModal user={workUser} onClose={() => setWorkUser(null)} />
      ) : null}
    </div>
  );
}

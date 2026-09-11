// Roles & permissions (spec sections 30-31). Permissions come from the server catalog.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Card, Icon, Loading, ErrorBlock, Empty, Modal, Field } from '../components/ui.jsx';
import { classNames } from '../utils.js';

function RoleModal({ role, catalog, onClose, onSaved }) {
  const { show } = useToast();
  const editing = !!role;
  const isSuper = (role?.permissions || []).includes('*');
  const [form, setForm] = useState(() => ({
    name: role?.name || '',
    description: role?.description || '',
    active: role?.active !== false,
    permissions: role?.permissions || []
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const has = (key) => form.permissions.includes(key);
  const toggle = (key) => {
    setForm((f) => ({
      ...f,
      permissions: has(key) ? f.permissions.filter((p) => p !== key) : [...f.permissions, key]
    }));
  };
  const toggleGroup = (group) => {
    const keys = group.permissions.map((p) => p.key);
    const all = keys.every((k) => has(k));
    setForm((f) => ({
      ...f,
      permissions: all
        ? f.permissions.filter((p) => !keys.includes(p))
        : [...new Set([...f.permissions, ...keys])]
    }));
  };

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Role name is required.'); return; }
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        description: form.description,
        active: form.active,
        permissions: isSuper ? ['*'] : form.permissions
      };
      if (editing) await api.put(`/roles/${role.id}`, payload);
      else await api.post('/roles', payload);
      show(editing ? 'Role updated' : 'Role created', 'success');
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
      title={editing ? `Edit role — ${role.name}` : 'New role'}
      onClose={onClose}
      size="modal-lg"
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="role-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : editing ? 'Save changes' : 'Create role'}
          </button>
        </>
      )}
    >
      <form id="role-form" onSubmit={submit}>
        {error ? <div className="error-block">{error}</div> : null}
        <div className="input-row">
          <Field label="Role name *" className="grow">
            <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Status">
            <label className="checkbox-row" style={{ paddingTop: 8 }}>
              <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
              Active
            </label>
          </Field>
        </div>
        <Field label="Description">
          <textarea className="textarea" rows="2" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>

        {isSuper ? (
          <div className="warning-block">
            This is the administrator role with full access (<strong>*</strong>). It cannot be limited.
          </div>
        ) : (
          <>
            <div className="divider" />
            <div className="flex between mb-8">
              <span className="strong">Permissions</span>
              <span className="small muted">{form.permissions.length} selected</span>
            </div>
            <div style={{ maxHeight: 420, overflowY: 'auto' }}>
              {catalog.map((group) => {
                const keys = group.permissions.map((p) => p.key);
                const all = keys.every((k) => has(k));
                return (
                  <div className="card mb-8" key={group.group}>
                    <div className="card-body" style={{ padding: '10px 14px' }}>
                      <label className="checkbox-row strong">
                        <input type="checkbox" checked={all} onChange={() => toggleGroup(group)} />
                        {group.group}
                      </label>
                      <div style={{ paddingLeft: 24 }}>
                        {group.permissions.map((p) => (
                          <label className="checkbox-row" key={p.key}>
                            <input type="checkbox" checked={has(p.key)} onChange={() => toggle(p.key)} />
                            {p.label}
                          </label>
                        ))}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </>
        )}
      </form>
    </Modal>
  );
}

export default function RolesPage() {
  const { meta, hasPermission } = useAuth();
  const { show, confirm } = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [editRole, setEditRole] = useState(null);
  const [showNew, setShowNew] = useState(false);

  const catalog = useMemo(() => meta?.permissionCatalog || [], [meta]);

  const load = async () => {
    try {
      setRows(await api.get('/roles'));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  };

  useEffect(() => { load(); }, []);

  const canCreate = hasPermission('roles.create');
  const canEdit = hasPermission('roles.edit');
  const canDelete = hasPermission('roles.delete');

  const toggleActive = async (r) => {
    try {
      await api.patch(`/roles/${r.id}/status`, { active: r.active === false });
      show(r.active === false ? 'Role activated' : 'Role deactivated', 'success');
      load();
    } catch (err) { show(err.message, 'error'); }
  };

  const remove = async (r) => {
    const ok = await confirm({
      title: `Delete role "${r.name}"?`,
      message: r.userCount > 0 ? `${r.userCount} user(s) still have this role.` : 'This role is not assigned to anyone.',
      confirmLabel: 'Delete role'
    });
    if (!ok) return;
    try {
      await api.del(`/roles/${r.id}`);
      show('Role deleted', 'success');
      load();
    } catch (err) { show(err.message, 'error'); }
  };

  return (
    <div>
      <div className="page-header">
        <div className="grow">
          <h1>Roles & permissions</h1>
          <div className="sub">{rows ? `${rows.length} role(s)` : 'Access control for the workshop team'}</div>
        </div>
        {canCreate ? (
          <button type="button" className="btn btn-primary" onClick={() => setShowNew(true)}>
            <Icon name="plus" size={15} /> New role
          </button>
        ) : null}
      </div>

      {error ? <ErrorBlock message={error} /> : null}
      {!rows ? <Loading /> : rows.length === 0 ? <Empty icon="roles" title="No roles" /> : (
        <div className="grid grid-2">
          {rows.map((r) => {
            const isSuper = (r.permissions || []).includes('*');
            return (
              <Card
                key={r.id}
                className={r.active === false ? 'muted' : ''}
                title={(
                  <span className="flex" style={{ gap: 8, alignItems: 'center' }}>
                    {r.name}
                    {isSuper ? <span className="badge badge-purple">full access</span> : null}
                    {r.active === false ? <span className="badge badge-slate">inactive</span> : null}
                  </span>
                )}
                actions={(
                  <div className="flex" style={{ gap: 2 }}>
                    {canEdit ? (
                      <>
                        <button type="button" className="icon-btn" title="Edit role" onClick={() => setEditRole(r)}><Icon name="edit" size={15} /></button>
                        {!isSuper ? (
                          <button type="button" className="icon-btn" title={r.active === false ? 'Activate' : 'Deactivate'} onClick={() => toggleActive(r)}>
                            <Icon name={r.active === false ? 'checkCircle' : 'x'} size={15} />
                          </button>
                        ) : null}
                      </>
                    ) : null}
                    {canDelete && !isSuper ? (
                      <button type="button" className="icon-btn" title="Delete" onClick={() => remove(r)}><Icon name="trash" size={15} /></button>
                    ) : null}
                  </div>
                )}
              >
                {r.description ? <p className="small muted">{r.description}</p> : null}
                <div className="flex flex-wrap mt-8" style={{ gap: 6 }}>
                  <span className="badge badge-blue">{r.userCount || 0} user(s)</span>
                  <span className="badge badge-slate">{isSuper ? 'all permissions' : `${(r.permissions || []).length} permission(s)`}</span>
                </div>
                {!isSuper && (r.permissions || []).length > 0 ? (
                  <div className="small muted mt-8" style={{ overflowWrap: 'anywhere' }}>
                    {(r.permissions || []).slice(0, 8).join(', ')}
                    {(r.permissions || []).length > 8 ? ` +${r.permissions.length - 8} more` : ''}
                  </div>
                ) : null}
              </Card>
            );
          })}
        </div>
      )}

      {showNew ? (
        <RoleModal catalog={catalog} onClose={() => setShowNew(false)} onSaved={load} />
      ) : null}
      {editRole ? (
        <RoleModal role={editRole} catalog={catalog} onClose={() => setEditRole(null)} onSaved={load} />
      ) : null}
    </div>
  );
}

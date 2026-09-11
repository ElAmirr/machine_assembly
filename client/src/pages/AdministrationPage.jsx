// Administration: app settings, catalogs (departments, locations, project types,
// evidence types), storage folder + backups (spec sections 19, 29).
import { useCallback, useEffect, useState } from 'react';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Card, Icon, Loading, ErrorBlock, Empty, Modal, Field, Tabs } from '../components/ui.jsx';
import { fmtBytes, fmtDateTime } from '../utils.js';

// ------------------------------------------------------------------ generic catalog tab

function ConfigTab({ path, label, hint }) {
  const { hasPermission } = useAuth();
  const { show, confirm } = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null); // { item } or { item: null }

  const load = useCallback(async () => {
    try {
      setRows(await api.get(path));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [path]);

  useEffect(() => { load(); }, [load]);

  const canManage = hasPermission('config.manage');

  const toggleActive = async (row) => {
    try {
      await api.put(`${path}/${row.id}`, { active: row.active === false });
      show(row.active === false ? `${label} activated` : `${label} deactivated`, 'success');
      load();
    } catch (err) { show(err.message, 'error'); }
  };

  const remove = async (row) => {
    const ok = await confirm({
      title: `Delete ${label.toLowerCase()} "${row.name}"?`,
      message: 'Items referenced by projects or people cannot be deleted — deactivate them instead.',
      confirmLabel: 'Delete'
    });
    if (!ok) return;
    try {
      await api.del(`${path}/${row.id}`);
      show(`${label} deleted`, 'success');
      load();
    } catch (err) { show(err.message, 'error'); }
  };

  return (
    <Card
      title={label}
      actions={canManage ? (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal({ item: null })}>
          <Icon name="plus" size={14} /> New {label.toLowerCase()}
        </button>
      ) : null}
      bodyClass="card-body tight"
    >
      {hint ? <div className="small muted" style={{ padding: '10px 14px' }}>{hint}</div> : null}
      {error ? <div style={{ padding: 14 }}><ErrorBlock message={error} /></div> : null}
      {!rows ? <Loading /> : rows.length === 0 ? <Empty icon="folder" title={`No ${label.toLowerCase()} entries`} /> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Name</th><th>Code</th><th>Description</th><th>Status</th><th className="actions" /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="strong">{r.name}</td>
                  <td className="muted">{r.code || '—'}</td>
                  <td className="small muted" style={{ overflowWrap: 'anywhere' }}>{r.description || '—'}</td>
                  <td>{r.active === false ? <span className="badge badge-slate">inactive</span> : <span className="badge badge-green">active</span>}</td>
                  <td className="actions">
                    {canManage ? (
                      <div className="flex" style={{ gap: 2, justifyContent: 'flex-end' }}>
                        <button type="button" className="icon-btn" title="Edit" onClick={() => setModal({ item: r })}><Icon name="edit" size={15} /></button>
                        <button type="button" className="icon-btn" title={r.active === false ? 'Activate' : 'Deactivate'} onClick={() => toggleActive(r)}>
                          <Icon name={r.active === false ? 'checkCircle' : 'x'} size={15} />
                        </button>
                        <button type="button" className="icon-btn" title="Delete" onClick={() => remove(r)}><Icon name="trash" size={15} /></button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal ? (
        <ConfigModal path={path} label={label} item={modal.item} onClose={() => setModal(null)} onSaved={load} />
      ) : null}
    </Card>
  );
}

function ConfigModal({ path, label, item, onClose, onSaved }) {
  const { show } = useToast();
  const editing = !!item;
  const [form, setForm] = useState({
    name: item?.name || '', code: item?.code || '', description: item?.description || '', active: item?.active !== false
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Name is required.'); return; }
    setBusy(true);
    try {
      const payload = { name: form.name.trim(), code: form.code, description: form.description, active: form.active };
      if (editing) await api.put(`${path}/${item.id}`, payload);
      else await api.post(path, payload);
      show(`${label} ${editing ? 'updated' : 'created'}`, 'success');
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
      title={editing ? `Edit ${label.toLowerCase()}` : `New ${label.toLowerCase()}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="config-form" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      )}
    >
      <form id="config-form" onSubmit={submit}>
        {error ? <div className="error-block">{error}</div> : null}
        <div className="input-row">
          <Field label="Name *" className="grow">
            <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
          </Field>
          <Field label="Code">
            <input className="input" value={form.code} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
          </Field>
        </div>
        <Field label="Description">
          <textarea className="textarea" rows="2" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
        <label className="checkbox-row">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
          Active
        </label>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ evidence types tab

function EvidenceTypesTab() {
  const { hasPermission } = useAuth();
  const { show, confirm } = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [modal, setModal] = useState(null);

  const load = useCallback(async () => {
    try {
      setRows(await api.get('/evidence-types'));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const canManage = hasPermission('config.manage');
  const keyOf = (t) => t.key || t.code || t.name;
  const labelOf = (t) => t.label || t.name;

  const remove = async (row) => {
    const ok = await confirm({
      title: `Delete evidence type "${labelOf(row)}"?`,
      message: 'Types used by tasks or templates cannot be deleted — deactivate them instead.',
      confirmLabel: 'Delete'
    });
    if (!ok) return;
    try {
      await api.del(`/evidence-types/${row.id}`);
      show('Evidence type deleted', 'success');
      load();
    } catch (err) { show(err.message, 'error'); }
  };

  return (
    <Card
      title="Evidence types"
      actions={canManage ? (
        <button type="button" className="btn btn-primary btn-sm" onClick={() => setModal({ item: null })}>
          <Icon name="plus" size={14} /> New evidence type
        </button>
      ) : null}
      bodyClass="card-body tight"
    >
      <div className="small muted" style={{ padding: '10px 14px' }}>
        These types are selectable per step in workflow templates. "File" types require an upload; measurement, comment and checklist capture data directly.
      </div>
      {error ? <div style={{ padding: 14 }}><ErrorBlock message={error} /></div> : null}
      {!rows ? <Loading /> : rows.length === 0 ? <Empty icon="camera" title="No evidence types" /> : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr><th>Label</th><th>Key</th><th>Kind</th><th>Accept</th><th>Status</th><th className="actions" /></tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id}>
                  <td className="strong">{labelOf(r)}</td>
                  <td className="muted">{keyOf(r)}</td>
                  <td><span className="badge badge-slate">{r.kind || 'file'}</span></td>
                  <td className="small muted">{r.accept || '—'}</td>
                  <td>{r.active === false ? <span className="badge badge-slate">inactive</span> : <span className="badge badge-green">active</span>}</td>
                  <td className="actions">
                    {canManage ? (
                      <div className="flex" style={{ gap: 2, justifyContent: 'flex-end' }}>
                        <button type="button" className="icon-btn" title="Edit" onClick={() => setModal({ item: r })}><Icon name="edit" size={15} /></button>
                        <button
                          type="button" className="icon-btn"
                          title={r.active === false ? 'Activate' : 'Deactivate'}
                          onClick={async () => {
                            try {
                              await api.put(`/evidence-types/${r.id}`, { active: r.active === false });
                              load();
                            } catch (err) { show(err.message, 'error'); }
                          }}
                        >
                          <Icon name={r.active === false ? 'checkCircle' : 'x'} size={15} />
                        </button>
                        <button type="button" className="icon-btn" title="Delete" onClick={() => remove(r)}><Icon name="trash" size={15} /></button>
                      </div>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {modal ? (
        <EvidenceTypeModal item={modal.item} onClose={() => setModal(null)} onSaved={load} />
      ) : null}
    </Card>
  );
}

function EvidenceTypeModal({ item, onClose, onSaved }) {
  const { show } = useToast();
  const editing = !!item;
  const [form, setForm] = useState({
    name: item?.label || item?.name || '',
    code: item?.key || item?.code || '',
    kind: item?.kind || 'file',
    accept: item?.accept || '',
    active: item?.active !== false
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Label is required.'); return; }
    setBusy(true);
    try {
      const payload = {
        name: form.name.trim(),
        code: form.code.trim().toLowerCase().replace(/\s+/g, '_'),
        description: '',
        active: form.active,
        kind: form.kind,
        accept: form.kind === 'file' ? form.accept : ''
      };
      if (editing) await api.put(`/evidence-types/${item.id}`, { name: payload.name, accept: payload.accept, kind: payload.kind, active: payload.active });
      else await api.post('/evidence-types', payload);
      show(`Evidence type ${editing ? 'updated' : 'created'}`, 'success');
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
      title={editing ? 'Edit evidence type' : 'New evidence type'}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="evtype-form" className="btn btn-primary" disabled={busy}>{busy ? 'Saving…' : 'Save'}</button>
        </>
      )}
    >
      <form id="evtype-form" onSubmit={submit}>
        {error ? <div className="error-block">{error}</div> : null}
        <div className="input-row">
          <Field label="Label *" className="grow">
            <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} placeholder="e.g. Calibration certificate" />
          </Field>
          <Field label="Key" hint="used in workflows, e.g. certificate">
            <input className="input" value={form.code} disabled={editing} onChange={(e) => setForm((f) => ({ ...f, code: e.target.value }))} />
          </Field>
        </div>
        <div className="input-row">
          <Field label="Kind">
            <select className="select" value={form.kind} onChange={(e) => setForm((f) => ({ ...f, kind: e.target.value }))}>
              <option value="file">File upload</option>
              <option value="measurement">Measurement</option>
              <option value="comment">Comment</option>
              <option value="checklist">Checklist</option>
            </select>
          </Field>
          {form.kind === 'file' ? (
            <Field label="Accepted files" hint="e.g. image/* or .pdf,.docx">
              <input className="input" value={form.accept} onChange={(e) => setForm((f) => ({ ...f, accept: e.target.value }))} />
            </Field>
          ) : null}
        </div>
        <label className="checkbox-row">
          <input type="checkbox" checked={form.active} onChange={(e) => setForm((f) => ({ ...f, active: e.target.checked }))} />
          Active
        </label>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ storage tab

function StorageTab() {
  const { hasPermission } = useAuth();
  const { show } = useToast();
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setData(await api.get('/admin/storage'));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const backupNow = async () => {
    setBusy(true);
    try {
      const res = await api.post('/admin/backups');
      show(`Backup created (${res.files} files)`, 'success');
      load();
    } catch (err) {
      show(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  if (!hasPermission('settings.manage')) {
    return <Empty icon="admin" title="No access" hint="Storage information requires the settings permission." />;
  }
  if (error) return <ErrorBlock message={error} />;
  if (!data) return <Loading />;

  return (
    <div>
      <Card title="Data folder (shared between PCs)" className="mb-16">
        <dl className="def-list">
          <dt>Data folder</dt><dd style={{ overflowWrap: 'anywhere' }}>{data.dataDir}</dd>
          <dt>Storage driver</dt><dd><span className="badge badge-green">{data.storageDriver}</span></dd>
          <dt>Backups folder</dt><dd style={{ overflowWrap: 'anywhere' }}>{data.backupsDir}</dd>
          <dt>Max upload</dt><dd>{data.maxUploadMb} MB</dd>
        </dl>
        <div className="info-block small mt-8">
          Point every PC to this same folder (local disk, mapped network drive or UNC path like \\server\share\mam-data).
          Data is stored as plain .json files with atomic writes and file locking, so several PCs can work on the same workshop data.
        </div>
      </Card>

      <Card
        title={`Storage files (${data.files?.length || 0})`}
        className="mb-16"
        bodyClass="card-body tight"
      >
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>File</th><th>Size</th><th>Modified</th></tr></thead>
            <tbody>
              {(data.files || []).map((f) => (
                <tr key={f.name}>
                  <td className="strong">{f.name}</td>
                  <td className="muted">{fmtBytes(f.size)}</td>
                  <td className="small muted">{fmtDateTime(f.modified)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>

      <Card
        title={`Backups (${data.backups?.length || 0})`}
        actions={(
          <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={backupNow}>
            <Icon name="download" size={14} /> {busy ? 'Creating…' : 'Create backup now'}
          </button>
        )}
        bodyClass="card-body tight"
      >
        {(!data.backups || data.backups.length === 0) ? <Empty icon="folder" title="No backups yet" hint="A backup runs automatically every day the server is running." /> : (
          <div className="table-wrap">
            <table className="table">
              <thead><tr><th>Backup</th><th>Reason</th><th>Files</th><th>Created</th></tr></thead>
              <tbody>
                {data.backups.map((b) => (
                  <tr key={b.name}>
                    <td className="strong">{b.name}</td>
                    <td className="muted">{b.reason || '—'}</td>
                    <td className="muted">{b.files ?? '—'}</td>
                    <td className="small muted nowrap">{b.at ? fmtDateTime(b.at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

// ------------------------------------------------------------------ settings tab

function SettingsTab({ onSaved }) {
  const { hasPermission, meta } = useAuth();
  const { show } = useToast();
  const [form, setForm] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.get('/settings').then(setForm).catch((err) => setError(err.message));
  }, []);

  if (!hasPermission('settings.manage')) {
    return <Empty icon="admin" title="No access" hint="Application settings require the settings permission." />;
  }
  if (error) return <ErrorBlock message={error} />;
  if (!form) return <Loading />;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const saved = await api.put('/settings', {
        appName: form.appName || '',
        sequentialStepsDefault: form.sequentialStepsDefault,
        requireEvidenceDefault: form.requireEvidenceDefault,
        dueSoonHours: Number(form.dueSoonHours) || 48
      });
      setForm(saved);
      show('Settings saved', 'success');
      onSaved?.();
    } catch (err) {
      show(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card title="Application settings">
      <form onSubmit={submit} style={{ maxWidth: 520 }}>
        <Field label="Application name" hint={`Defaults to "${meta?.appName || 'Machine Assembly Manager'}" when empty.`}>
          <input className="input" value={form.appName || ''} onChange={(e) => setForm((f) => ({ ...f, appName: e.target.value }))} />
        </Field>
        <Field label="'Due soon' alert window (hours)" hint="Tasks due within this window trigger a notification.">
          <input type="number" min="1" className="input" value={form.dueSoonHours ?? 48} onChange={(e) => setForm((f) => ({ ...f, dueSoonHours: e.target.value }))} />
        </Field>
        <label className="checkbox-row">
          <input type="checkbox" checked={form.sequentialStepsDefault !== false} onChange={(e) => setForm((f) => ({ ...f, sequentialStepsDefault: e.target.checked }))} />
          New tasks require steps to be completed in order by default
        </label>
        <label className="checkbox-row">
          <input type="checkbox" checked={form.requireEvidenceDefault !== false} onChange={(e) => setForm((f) => ({ ...f, requireEvidenceDefault: e.target.checked }))} />
          New steps require evidence by default
        </label>
        <div className="mt-16">
          <button type="submit" className="btn btn-primary" disabled={busy}>
            <Icon name="check" size={14} /> {busy ? 'Saving…' : 'Save settings'}
          </button>
        </div>
      </form>
    </Card>
  );
}

// ------------------------------------------------------------------ page

export default function AdministrationPage() {
  const { hasPermission } = useAuth();
  const [tab, setTab] = useState('settings');

  const canConfig = hasPermission(['config.manage']);
  const canSettings = hasPermission(['settings.manage']);

  const tabs = [
    canSettings ? { key: 'settings', label: 'App settings' } : null,
    canConfig ? { key: 'departments', label: 'Departments' } : null,
    canConfig ? { key: 'locations', label: 'Locations' } : null,
    canConfig ? { key: 'projectTypes', label: 'Project types' } : null,
    canConfig ? { key: 'evidenceTypes', label: 'Evidence types' } : null,
    canSettings ? { key: 'storage', label: 'Storage & backups' } : null
  ].filter(Boolean);

  if (tabs.length === 0) {
    return <Empty icon="admin" title="No access" hint="Administration requires configuration permissions." />;
  }

  const active = tabs.some((t) => t.key === tab) ? tab : tabs[0].key;

  return (
    <div>
      <div className="page-header">
        <div className="grow">
          <h1>Administration</h1>
          <div className="sub">Application configuration, catalogs and shared data storage</div>
        </div>
      </div>

      <Tabs tabs={tabs} active={active} onChange={setTab} />

      <div className="mt-16">
        {active === 'settings' ? <SettingsTab /> : null}
        {active === 'departments' ? (
          <ConfigTab path="/departments" label="Department" hint="Departments are used to group people and projects." />
        ) : null}
        {active === 'locations' ? (
          <ConfigTab path="/locations" label="Location" hint="Workshop locations such as Workshop A, Assembly Hall…" />
        ) : null}
        {active === 'projectTypes' ? (
          <ConfigTab path="/project-types" label="Project type" hint="Project types drive the workflow template selection (e.g. Replacement, Assembly, Refurbishment)." />
        ) : null}
        {active === 'evidenceTypes' ? <EvidenceTypesTab /> : null}
        {active === 'storage' ? <StorageTab /> : null}
      </div>
    </div>
  );
}

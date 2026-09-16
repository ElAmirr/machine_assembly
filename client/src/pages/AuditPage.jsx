// Audit trail: who did what, when (spec section 28).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { Card, Icon, Loading, ErrorBlock, Empty, Modal } from '../components/ui.jsx';
import { useRefs } from '../hooks/useRefs.js';
import { fmtDateTime, fmtRelative } from '../utils.js';

const ENTITY_LINKS = {
  project: (r) => `/projects/${r.entityId}`,
  task: (r) => `/tasks/${r.entityId}`,
  step: (r) => (r.taskId ? `/tasks/${r.taskId}` : null)
};

export default function AuditPage() {
  const { refs } = useRefs();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [entityType, setEntityType] = useState('');
  const [action, setAction] = useState('');
  const [userId, setUserId] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [detail, setDetail] = useState(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set('q', q.trim());
      if (entityType) qs.set('entityType', entityType);
      if (action) qs.set('action', action);
      if (userId) qs.set('userId', userId);
      if (from) qs.set('from', new Date(from).toISOString());
      if (to) qs.set('to', new Date(`${to}T23:59:59`).toISOString());
      qs.set('limit', '500');
      setRows(await api.get(`/audit-logs?${qs.toString()}`));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [q, entityType, action, userId, from, to]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const entityTypes = ['project', 'task', 'step', 'evidence', 'user', 'role', 'workflowTemplate', 'component', 'tool', 'comment', 'attachment', 'settings'];
  const actions = ['create', 'update', 'delete', 'start', 'complete', 'submit', 'approve', 'reject', 'status', 'activate', 'deactivate', 'login', 'logout', 'upload_evidence', 'password_reset', 'backup'];

  return (
    <div>
      <div className="page-header">
        <div className="grow">
          <h1>Audit trail</h1>
          <div className="sub">{rows ? `${rows.length} recorded event(s)` : 'Complete activity history'}</div>
        </div>
      </div>

      <Card bodyClass="card-body">
        <div className="toolbar mb-16">
          <div className="search-input-wrap grow">
            <Icon name="search" size={15} />
            <input className="input" placeholder="Search user, item, details…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="select" style={{ width: 160 }} value={entityType} onChange={(e) => setEntityType(e.target.value)}>
            <option value="">All types</option>
            {entityTypes.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
          <select className="select" style={{ width: 160 }} value={action} onChange={(e) => setAction(e.target.value)}>
            <option value="">All actions</option>
            {actions.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <select className="select" style={{ width: 180 }} value={userId} onChange={(e) => setUserId(e.target.value)}>
            <option value="">All users</option>
            {refs.users.map((u) => (
              <option key={u.id} value={u.id}>{`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username}</option>
            ))}
          </select>
          <input type="date" className="input" style={{ width: 150 }} value={from} onChange={(e) => setFrom(e.target.value)} title="From" />
          <input type="date" className="input" style={{ width: 150 }} value={to} onChange={(e) => setTo(e.target.value)} title="To" />
        </div>

        {error ? <ErrorBlock message={error} /> : null}
        {!rows ? <Loading /> : rows.length === 0 ? <Empty icon="audit" title="No audit events found" /> : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>When</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Item</th>
                  <th>Details</th>
                  <th className="actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((r) => {
                  const link = ENTITY_LINKS[r.entityType]?.(r);
                  return (
                    <tr key={r.id}>
                      <td className="small nowrap">
                        {fmtDateTime(r.at)}
                        <div className="small muted">{fmtRelative(r.at)}</div>
                      </td>
                      <td className="muted nowrap">{r.userName || '—'}</td>
                      <td><span className="badge badge-slate">{r.action}</span></td>
                      <td className="small nowrap">
                        <span className="muted">{r.entityType}</span>
                        <div className="strong" style={{ overflowWrap: 'anywhere' }}>{r.entityLabel || '—'}</div>
                      </td>
                      <td className="small muted" style={{ overflowWrap: 'anywhere' }}>{r.details || '—'}</td>
                      <td className="actions">
                        <div className="flex" style={{ gap: 4, justifyContent: 'flex-end' }}>
                          {r.changes ? (
                            <button type="button" className="icon-btn" title="Change details" onClick={() => setDetail(r)}>
                              <Icon name="eye" size={15} />
                            </button>
                          ) : null}
                          {link ? <Link className="icon-btn" title="Open item" to={link}><Icon name="chevronRight" size={15} /></Link> : null}
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

      {detail ? (
        <Modal title="Change details" onClose={() => setDetail(null)} size="modal-lg"
          footer={<button type="button" className="btn btn-secondary" onClick={() => setDetail(null)}>Close</button>}
        >
          <div className="small mb-8">
            <strong>{detail.action}</strong> on {detail.entityType} · {detail.entityLabel}
          </div>
          <pre style={{ background: 'var(--slate-soft)', padding: 12, borderRadius: 8, fontSize: 12, overflow: 'auto', maxHeight: 420 }}>
            {JSON.stringify(detail.changes, null, 2)}
          </pre>
        </Modal>
      ) : null}
    </div>
  );
}

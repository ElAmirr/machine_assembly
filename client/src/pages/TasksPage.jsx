// Task list with filters (spec sections 7-10). Everyone sees own/role tasks, managers see all.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Card, Icon, Loading, ErrorBlock, Empty, StatusBadge, ProgressBar } from '../components/ui.jsx';
import { useRefs } from '../hooks/useRefs.js';
import { fmtDate, dueLabel, classNames } from '../utils.js';

const BUCKETS = [
  { key: 'all', label: 'All tasks' },
  { key: 'mine', label: 'Assigned to me' },
  { key: 'dueToday', label: 'Due today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'waitingApproval', label: 'Waiting approval' }
];

export default function TasksPage() {
  const navigate = useNavigate();
  const [params, setParams] = useSearchParams();
  const { meta } = useAuth();
  const { refs } = useRefs();

  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [q, setQ] = useState('');
  const [status, setStatus] = useState(params.get('status') || '');
  const [roleId, setRoleId] = useState('');
  const [assignee, setAssignee] = useState('');
  const [bucket, setBucket] = useState(params.get('bucket') || 'all');

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (q.trim()) qs.set('q', q.trim());
      if (status) qs.set('status', status);
      if (roleId) qs.set('roleId', roleId);
      if (assignee) qs.set('assignedUserId', assignee);
      if (bucket === 'mine') qs.set('mine', '1');
      if (bucket === 'overdue') qs.set('overdue', '1');
      if (bucket === 'waitingApproval') qs.set('waitingApproval', '1');
      if (bucket === 'dueToday') qs.set('dueToday', '1');
      setRows(await api.get(`/tasks?${qs.toString()}`));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [q, status, roleId, assignee, bucket]);

  useEffect(() => {
    const t = setTimeout(load, q ? 250 : 0);
    return () => clearTimeout(t);
  }, [load, q]);

  const statusLabel = (k) => (meta?.statuses?.task || []).find((s) => s.key === k)?.label || k;

  const pickBucket = (key) => {
    setBucket(key);
    const next = new URLSearchParams(params);
    if (key === 'all') next.delete('bucket'); else next.set('bucket', key);
    setParams(next, { replace: true });
  };

  const counts = useMemo(() => {
    const all = rows || [];
    return {
      total: all.length,
      overdue: all.filter((t) => t.computed?.overdue || (t.plannedEnd && !['completed', 'approved'].includes(t.status) && new Date(t.plannedEnd).getTime() < Date.now())).length,
      inProgress: all.filter((t) => t.status === 'in_progress').length
    };
  }, [rows]);

  return (
    <div>
      <div className="page-header">
        <div className="grow">
          <h1>Tasks</h1>
          <div className="sub">
            {rows ? `${counts.total} task(s) · ${counts.inProgress} in progress${counts.overdue ? ` · ${counts.overdue} overdue` : ''}` : 'Work items across all machines'}
          </div>
        </div>
      </div>

      <Card bodyClass="card-body">
        <div className="toolbar mb-16">
          <div className="search-input-wrap grow">
            <Icon name="search" size={15} />
            <input className="input" placeholder="Search task, machine, project code…" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="select" style={{ width: 170 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="">All statuses</option>
            {(meta?.statuses?.task || []).map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
          <select className="select" style={{ width: 180 }} value={roleId} onChange={(e) => setRoleId(e.target.value)}>
            <option value="">All roles</option>
            {refs.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
          </select>
          <select className="select" style={{ width: 180 }} value={assignee} onChange={(e) => setAssignee(e.target.value)}>
            <option value="">Any assignee</option>
            {refs.users.filter((u) => u.active !== false).map((u) => (
              <option key={u.id} value={u.id}>{`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username}</option>
            ))}
          </select>
        </div>

        <div className="tabs mb-16">
          {BUCKETS.map((b) => (
            <button key={b.key} type="button" className={classNames('tab', bucket === b.key && 'active')} onClick={() => pickBucket(b.key)}>
              {b.label}
            </button>
          ))}
        </div>

        {error ? <ErrorBlock message={error} /> : null}
        {!rows ? <Loading /> : rows.length === 0 ? (
          <Empty icon="tasks" title="No tasks found" hint="Adjust the filters or create tasks from a project." />
        ) : (
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th style={{ width: 64 }}>Task</th>
                  <th>Machine / project</th>
                  <th>Role / assigned</th>
                  <th>Status</th>
                  <th>Progress</th>
                  <th>Planned end</th>
                  <th>Steps</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((t) => {
                  const overdue = t.plannedEnd && !['completed', 'approved'].includes(t.status) && new Date(t.plannedEnd).getTime() < Date.now();
                  return (
                    <tr key={t.id} className="clickable" onClick={() => navigate(`/tasks/${t.id}`)}>
                      <td className="muted">{t.order || '—'}</td>
                      <td>
                        <div className="strong">{t.name}</div>
                        <div className="small muted">
                          {t.projectCode ? <Link to={`/projects/${t.projectId}`} onClick={(e) => e.stopPropagation()}>{t.projectCode}</Link> : null}
                          {t.machineName ? ` · ${t.machineName}` : ''}
                        </div>
                      </td>
                      <td className="muted nowrap">
                        {t.roleName || '—'}
                        <br /><span className="small">{t.assignedName || 'unassigned'}</span>
                      </td>
                      <td><StatusBadge status={t.status} label={statusLabel(t.status)} /></td>
                      <td style={{ minWidth: 110 }}>
                        <ProgressBar value={t.progress} />
                        <div className="small muted" style={{ marginTop: 4 }}>{t.stepsDone}/{t.stepsTotal} steps</div>
                      </td>
                      <td className="small nowrap">
                        {fmtDate(t.plannedEnd)}
                        {overdue ? <div style={{ color: 'var(--red)' }}>{dueLabel(t.plannedEnd)}</div> : null}
                      </td>
                      <td className="muted">{t.stepsTotal}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}

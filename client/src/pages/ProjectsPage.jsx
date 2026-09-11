// Projects list: filters, create/edit, open detail.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useRefs } from '../hooks/useRefs.js';
import {
  Card, Icon, Loading, ErrorBlock, Empty, StatusBadge, PriorityBadge, ProgressBar, SearchInput
} from '../components/ui.jsx';
import ProjectFormModal from '../components/ProjectFormModal.jsx';
import { fmtDate, dueLabel } from '../utils.js';

export default function ProjectsPage() {
  const { hasPermission, meta } = useAuth();
  const { refs } = useRefs();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [filters, setFilters] = useState({ q: '', status: '', projectTypeId: '', priority: '', mine: false, delayed: false });
  const [showForm, setShowForm] = useState(false);
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const canCreate = hasPermission('projects.create');

  useEffect(() => {
    if (params.get('new') === '1' && canCreate) {
      setShowForm(true);
      params.delete('new');
      setParams(params, { replace: true });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [params]);

  const load = useCallback(async () => {
    try {
      const query = new URLSearchParams();
      if (filters.q) query.set('q', filters.q);
      if (filters.status) query.set('status', filters.status);
      if (filters.projectTypeId) query.set('projectTypeId', filters.projectTypeId);
      if (filters.priority) query.set('priority', filters.priority);
      if (filters.mine) query.set('mine', '1');
      if (filters.delayed) query.set('delayed', '1');
      setRows(await api.get(`/projects?${query.toString()}`));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [filters]);

  useEffect(() => {
    const timer = setTimeout(load, filters.q ? 300 : 0);
    return () => clearTimeout(timer);
  }, [load, filters.q]);

  const typeById = useMemo(() => new Map(refs.projectTypes.map((t) => [t.id, t])), [refs.projectTypes]);
  const userById = useMemo(() => new Map(refs.users.map((u) => [u.id, u])), [refs.users]);

  const setFilter = (key) => (e) => {
    const value = e.target.type === 'checkbox' ? e.target.checked : e.target.value;
    setFilters((f) => ({ ...f, [key]: value }));
  };

  const statuses = meta?.statuses?.project || [];

  return (
    <div>
      <div className="page-header">
        <div className="grow">
          <h1>Machine Projects</h1>
          <div className="sub">Replacement · Assembly · Refurbishment</div>
        </div>
        <button type="button" className="btn btn-secondary" onClick={load}><Icon name="refresh" size={15} /> Refresh</button>
        {canCreate ? (
          <button type="button" className="btn btn-primary" onClick={() => setShowForm(true)}>
            <Icon name="plus" size={15} /> New project
          </button>
        ) : null}
      </div>

      <div className="toolbar">
        <SearchInput value={filters.q} onChange={(v) => setFilters((f) => ({ ...f, q: v }))} placeholder="Search machine, code, serial…" />
        <select className="select" style={{ width: 170 }} value={filters.status} onChange={setFilter('status')}>
          <option value="">All statuses</option>
          {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
        </select>
        <select className="select" style={{ width: 190 }} value={filters.projectTypeId} onChange={setFilter('projectTypeId')}>
          <option value="">All types</option>
          {(meta?.projectTypes || refs.projectTypes).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
        <select className="select" style={{ width: 140 }} value={filters.priority} onChange={setFilter('priority')}>
          <option value="">All priorities</option>
          {(meta?.priorities || []).map((p) => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <label className="checkbox-row"><input type="checkbox" checked={filters.mine} onChange={setFilter('mine')} /> Mine</label>
        <label className="checkbox-row"><input type="checkbox" checked={filters.delayed} onChange={setFilter('delayed')} /> Delayed / blocked</label>
      </div>

      <ErrorBlock message={error} />

      {!rows ? <Loading /> : rows.length === 0 ? (
        <Card><Empty icon="projects" title="No projects found" hint={canCreate ? 'Create the first project with the "New project" button.' : 'Nothing matches the current filters.'} /></Card>
      ) : (
        <Card bodyClass="card-body tight">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Project</th>
                  <th>Type</th>
                  <th>Status</th>
                  <th>Priority</th>
                  <th>Progress</th>
                  <th>Responsible</th>
                  <th>Planned end</th>
                  <th>Tasks</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id} className="clickable" onClick={() => navigate(`/projects/${p.id}`)}>
                    <td>
                      <div className="strong">{p.machineName}</div>
                      <div className="small muted">{p.code}{p.machineReference ? ` · ${p.machineReference}` : ''}</div>
                    </td>
                    <td className="muted nowrap">{typeById.get(p.projectTypeId)?.name || '—'}</td>
                    <td><StatusBadge status={p.status} label={statuses.find((s) => s.key === p.status)?.label} /></td>
                    <td><PriorityBadge priority={p.priority} label={(meta?.priorities || []).find((x) => x.key === p.priority)?.label} /></td>
                    <td style={{ minWidth: 130 }}>
                      <ProgressBar value={p.progress} />
                      <div className="small muted mt-8">{p.progress}%</div>
                    </td>
                    <td className="muted nowrap">{userById.get(p.responsibleUserId) ? `${userById.get(p.responsibleUserId).firstName || ''} ${userById.get(p.responsibleUserId).lastName || ''}`.trim() : '—'}</td>
                    <td className="nowrap">
                      <div>{fmtDate(p.plannedEndDate)}</div>
                      {p.overdue ? <div className="small" style={{ color: 'var(--red)', fontWeight: 650 }}>{dueLabel(p.plannedEndDate)}</div> : null}
                    </td>
                    <td className="muted nowrap">{p.tasksDone}/{p.tasksTotal}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      <div className="small muted mt-8">{rows ? `${rows.length} project(s)` : ''}</div>

      {showForm ? (
        <ProjectFormModal
          refs={refs}
          onClose={() => setShowForm(false)}
          onSaved={(saved) => { load(); if (saved?.id) navigate(`/projects/${saved.id}`); }}
        />
      ) : null}
    </div>
  );
}

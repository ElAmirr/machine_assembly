// Project detail: overview, task table, planning Gantt, files, comments, history.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { useRefs, userName } from '../hooks/useRefs.js';
import {
  Card, Icon, Loading, ErrorBlock, Empty, StatusBadge, PriorityBadge, ProgressBar, Tabs, Modal, Field
} from '../components/ui.jsx';
import ProjectFormModal from '../components/ProjectFormModal.jsx';
import Gantt from '../components/Gantt.jsx';
import AttachmentsPanel from '../components/AttachmentsPanel.jsx';
import CommentsPanel from '../components/CommentsPanel.jsx';
import { fmtDate, fmtDateTime, dueLabel, toDateInput } from '../utils.js';

function AddTaskModal({ project, tasks, refs, onClose, onSaved }) {
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState({
    name: '', description: '', roleId: '', assignedUserId: '', estimatedDuration: 1,
    durationUnit: 'days', plannedStart: toDateInput(project?.plannedEndDate || new Date().toISOString()),
    dependsOn: [], approvalRequired: false
  });

  const submit = async (e) => {
    e.preventDefault();
    if (!form.name.trim()) { setError('Task name is required.'); return; }
    setBusy(true);
    try {
      await api.post(`/projects/${project.id}/tasks`, {
        name: form.name.trim(),
        description: form.description.trim(),
        roleId: form.roleId || null,
        assignedUserId: form.assignedUserId || null,
        estimatedDuration: Number(form.estimatedDuration) || 0,
        durationUnit: form.durationUnit,
        plannedStart: form.plannedStart ? new Date(form.plannedStart).toISOString() : undefined,
        dependsOn: form.dependsOn,
        approvalRequired: form.approvalRequired
      });
      show('Task added to project', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const toggleDep = (id) => {
    setForm((f) => ({
      ...f,
      dependsOn: f.dependsOn.includes(id) ? f.dependsOn.filter((x) => x !== id) : [...f.dependsOn, id]
    }));
  };

  return (
    <Modal
      title="Add task to project"
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="add-task-form" className="btn btn-primary" disabled={busy}>{busy ? 'Adding…' : 'Add task'}</button>
        </>
      )}
    >
      <form id="add-task-form" onSubmit={submit}>
        {error ? <div className="error-block">{error}</div> : null}
        <Field label="Task name *">
          <input className="input" value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
        </Field>
        <Field label="Description">
          <textarea className="textarea" value={form.description} onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))} />
        </Field>
        <div className="input-row">
          <Field label="Required role">
            <select className="select" value={form.roleId} onChange={(e) => setForm((f) => ({ ...f, roleId: e.target.value }))}>
              <option value="">— None —</option>
              {refs.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
            </select>
          </Field>
          <Field label="Assign to">
            <select className="select" value={form.assignedUserId} onChange={(e) => setForm((f) => ({ ...f, assignedUserId: e.target.value }))}>
              <option value="">— Unassigned —</option>
              {refs.users.filter((u) => u.active !== false).map((u) => (
                <option key={u.id} value={u.id}>{`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username}</option>
              ))}
            </select>
          </Field>
        </div>
        <div className="input-row">
          <Field label="Duration">
            <input type="number" min="0" step="0.5" className="input" value={form.estimatedDuration} onChange={(e) => setForm((f) => ({ ...f, estimatedDuration: e.target.value }))} />
          </Field>
          <Field label="Unit">
            <select className="select" value={form.durationUnit} onChange={(e) => setForm((f) => ({ ...f, durationUnit: e.target.value }))}>
              <option value="hours">Hours</option>
              <option value="days">Days</option>
              <option value="minutes">Minutes</option>
            </select>
          </Field>
          <Field label="Planned start">
            <input type="date" className="input" value={form.plannedStart} onChange={(e) => setForm((f) => ({ ...f, plannedStart: e.target.value }))} />
          </Field>
        </div>
        {tasks.length > 0 ? (
          <Field label="Depends on (must finish before this task can start)" hint="Tasks already done can be unblocking immediately.">
            <div style={{ maxHeight: 150, overflowY: 'auto', border: '1px solid var(--border)', borderRadius: 8, padding: '6px 10px' }}>
              {tasks.map((t) => (
                <label key={t.id} className="checkbox-row" style={{ padding: '3px 0' }}>
                  <input type="checkbox" checked={form.dependsOn.includes(t.id)} onChange={() => toggleDep(t.id)} />
                  <span>{t.order}. {t.name} <span className="small muted">({t.status})</span></span>
                </label>
              ))}
            </div>
          </Field>
        ) : null}
        <label className="checkbox-row">
          <input type="checkbox" checked={form.approvalRequired} onChange={(e) => setForm((f) => ({ ...f, approvalRequired: e.target.checked }))} />
          Task requires approval when completed
        </label>
      </form>
    </Modal>
  );
}

export default function ProjectDetailPage() {
  const { id } = useParams();
  const navigate = useNavigate();
  const { hasPermission, meta } = useAuth();
  const { show, confirm } = useToast();
  const { refs } = useRefs();

  const [project, setProject] = useState(null);
  const [comments, setComments] = useState([]);
  const [history, setHistory] = useState([]);
  const [error, setError] = useState('');
  const [tab, setTab] = useState('overview');
  const [showEdit, setShowEdit] = useState(false);
  const [showAddTask, setShowAddTask] = useState(false);

  const load = useCallback(async () => {
    try {
      const [detail, commentRows] = await Promise.all([
        api.get(`/projects/${id}`),
        api.get(`/comments?projectId=${id}`).catch(() => [])
      ]);
      setProject(detail);
      setComments(commentRows);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (tab === 'history' && history.length === 0) {
      api.get(`/projects/${id}/history`).then(setHistory).catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab]);

  const statuses = meta?.statuses?.project || [];
  const userById = useMemo(() => new Map(refs.users.map((u) => [u.id, u])), [refs.users]);
  const typeById = useMemo(() => new Map(refs.projectTypes.map((t) => [t.id, t])), [refs.projectTypes]);

  if (error) return <ErrorBlock message={error} />;
  if (!project) return <Loading />;

  const tasks = project.tasks || [];
  const canEdit = hasPermission('projects.edit');
  const canDelete = hasPermission('projects.delete');

  const changeStatus = async (status) => {
    try {
      await api.patch(`/projects/${project.id}/status`, { status });
      show('Status updated', 'success');
      load();
    } catch (err) {
      show(err.message, 'error');
    }
  };

  const removeProject = async () => {
    const started = tasks.some((t) => !['not_started', 'ready'].includes(t.status));
    const ok = await confirm({
      title: `Delete project ${project.code}?`,
      message: started
        ? 'This project has started work. Deleting it removes all tasks, evidence, comments and files permanently.'
        : 'This project will be permanently deleted.',
      confirmLabel: 'Delete project'
    });
    if (!ok) return;
    try {
      await api.del(`/projects/${project.id}?force=1`);
      show('Project deleted', 'success');
      navigate('/projects');
    } catch (err) {
      show(err.message, 'error');
    }
  };

  const tabs = [
    { key: 'overview', label: 'Overview' },
    { key: 'tasks', label: 'Tasks', count: tasks.length },
    { key: 'planning', label: 'Planning' },
    { key: 'files', label: 'Files', count: (project.attachments || []).length },
    { key: 'comments', label: 'Comments', count: comments.length },
    { key: 'history', label: 'Machine history' }
  ];

  return (
    <div>
      <div className="page-header">
        <div className="grow">
          <Link to="/projects" className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="back" size={13} /> All projects
          </Link>
          <h1>{project.machineName} <span className="muted" style={{ fontWeight: 400 }}>{project.code}</span></h1>
          <div className="flex flex-wrap sub" style={{ gap: 8 }}>
            <StatusBadge status={project.status} label={statuses.find((s) => s.key === project.status)?.label} />
            <PriorityBadge priority={project.priority} label={(meta?.priorities || []).find((p) => p.key === project.priority)?.label} />
            {project.overdue ? <span className="badge badge-red"><Icon name="alert" size={11} /> {dueLabel(project.plannedEndDate)}</span> : null}
            <span className="muted">{typeById.get(project.projectTypeId)?.name || ''}</span>
            {project.templateName ? <span className="muted">· template: {project.templateName}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap">
          {canEdit ? (
            <select className="select" style={{ width: 160 }} value={project.status} onChange={(e) => changeStatus(e.target.value)}>
              {statuses.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          ) : null}
          {canEdit ? <button type="button" className="btn btn-secondary" onClick={() => setShowEdit(true)}><Icon name="edit" size={15} /> Edit</button> : null}
          {canDelete ? <button type="button" className="btn btn-danger-outline" onClick={removeProject}><Icon name="trash" size={15} /> Delete</button> : null}
        </div>
      </div>

      <Card className="mb-16">
        <div className="flex between mb-8">
          <span className="small muted">Overall progress</span>
          <span className="strong">{project.progress}% · {project.tasksDone}/{project.tasksTotal} tasks done</span>
        </div>
        <ProgressBar value={project.progress} />
      </Card>

      <Tabs tabs={tabs} active={tab} onChange={setTab} />

      {tab === 'overview' ? (
        <div className="grid grid-2">
          <Card title="Project information">
            <dl className="def-list">
              <dt>Machine</dt><dd>{project.machineName}</dd>
              <dt>Reference</dt><dd>{project.machineReference || '—'}</dd>
              <dt>Serial number</dt><dd>{project.machineSerial || '—'}</dd>
              <dt>Production line</dt><dd>{project.productionLine || '—'}</dd>
              <dt>Department</dt><dd>{refs.departments.find((d) => d.id === project.departmentId)?.name || '—'}</dd>
              <dt>Location</dt><dd>{refs.locations.find((l) => l.id === project.locationId)?.name || '—'}</dd>
              <dt>Responsible</dt><dd>{userName(refs.users, project.responsibleUserId) || '—'}</dd>
              <dt>Created by</dt><dd>{project.createdByName || '—'}</dd>
              <dt>Start date</dt><dd>{fmtDate(project.startDate)}</dd>
              <dt>Planned end</dt><dd>{fmtDate(project.plannedEndDate)} {project.overdue ? <span style={{ color: 'var(--red)' }}>(delayed)</span> : null}</dd>
              <dt>Actual end</dt><dd>{project.actualEndDate ? fmtDateTime(project.actualEndDate) : '—'}</dd>
            </dl>
          </Card>
          <Card title="Description">
            {project.description ? <p style={{ whiteSpace: 'pre-wrap' }}>{project.description}</p> : <span className="muted">No description</span>}
            <div className="divider" />
            <div className="small muted">Created {fmtDateTime(project.createdAt)}</div>
          </Card>
        </div>
      ) : null}

      {tab === 'tasks' ? (
        <Card
          title="Tasks"
          actions={hasPermission('tasks.create') ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setShowAddTask(true)}>
              <Icon name="plus" size={14} /> Add task
            </button>
          ) : null}
          bodyClass="card-body tight"
        >
          {tasks.length === 0 ? <Empty icon="tasks" title="No tasks" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr>
                    <th style={{ width: 34 }}>#</th>
                    <th>Task</th>
                    <th>Role / assigned</th>
                    <th>Status</th>
                    <th>Progress</th>
                    <th>Planned</th>
                    <th>Steps</th>
                    <th>Dependencies</th>
                  </tr>
                </thead>
                <tbody>
                  {tasks.map((t) => (
                    <tr key={t.id} className="clickable" onClick={() => navigate(`/tasks/${t.id}`)}>
                      <td className="muted">{t.order}</td>
                      <td>
                        <div className="strong">{t.name}</div>
                        {t.approvalRequired ? <span className="badge badge-purple" style={{ marginTop: 4 }}>needs approval</span> : null}
                        {t.computed?.blockedBy?.length ? (
                          <div className="small" style={{ color: 'var(--amber)' }}>blocked by {t.computed.blockedBy.length} task(s)</div>
                        ) : null}
                      </td>
                      <td className="muted nowrap">{t.roleName || '—'}<br /><span className="small">{t.assignedName || 'unassigned'}</span></td>
                      <td><StatusBadge status={t.status} label={(meta?.statuses?.task || []).find((s) => s.key === t.status)?.label} /></td>
                      <td style={{ minWidth: 110 }}><ProgressBar value={t.progress} /><div className="small muted mt-8">{t.stepsDone}/{t.stepsTotal} steps</div></td>
                      <td className="small nowrap muted">{fmtDate(t.plannedStart)}<br />{fmtDate(t.plannedEnd)}</td>
                      <td className="muted">{t.stepsTotal}</td>
                      <td className="small muted">{(t.dependsOn || []).length || '—'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {tab === 'planning' ? (
        <Card title="Planning (planned bars in blue/grey, actual bars in teal)">
          <Gantt tasks={tasks} onOpen={(t) => navigate(`/tasks/${t.id}`)} />
          <div className="chart-legend mt-8">
            <span><span className="dot" style={{ background: '#94a3b8' }} />Planned</span>
            <span><span className="dot" style={{ background: '#1d4ed8' }} />In progress</span>
            <span><span className="dot" style={{ background: '#15803d' }} />Done</span>
            <span><span className="dot" style={{ background: '#b91c1c' }} />Late / blocked</span>
            <span><span className="dot" style={{ background: '#0e7490' }} />Actual</span>
          </div>
        </Card>
      ) : null}

      {tab === 'files' ? (
        <AttachmentsPanel
          ownerType="project"
          ownerId={project.id}
          attachments={project.attachments}
          onChanged={load}
          title="Project files"
        />
      ) : null}

      {tab === 'comments' ? (
        <CommentsPanel ownerType="project" ownerId={project.id} comments={comments} onChanged={load} />
      ) : null}

      {tab === 'history' ? (
        <Card title={`Machine history — ${project.machineName}`} bodyClass="card-body tight">
          {history.length === 0 ? <Empty icon="machines" title="No history found" /> : (
            <div className="table-wrap">
              <table className="table">
                <thead>
                  <tr><th>Project</th><th>Status</th><th>Progress</th><th>Start</th><th>Planned end</th><th>Actual end</th><th /></tr>
                </thead>
                <tbody>
                  {history.map((h) => (
                    <tr key={h.id} className={h.id === project.id ? '' : 'clickable'} onClick={() => h.id !== project.id && navigate(`/projects/${h.id}`)}>
                      <td>
                        <span className="strong">{h.code}</span>
                        {h.id === project.id ? <span className="badge badge-blue" style={{ marginLeft: 7 }}>current</span> : null}
                      </td>
                      <td><StatusBadge status={h.status} /></td>
                      <td>{h.progress}%</td>
                      <td className="muted">{fmtDate(h.startDate)}</td>
                      <td className="muted">{fmtDate(h.plannedEndDate)}</td>
                      <td className="muted">{fmtDate(h.actualEndDate)}</td>
                      <td className="actions">{h.id !== project.id ? <Icon name="chevronRight" size={15} /> : null}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      ) : null}

      {showEdit ? (
        <ProjectFormModal
          project={project}
          refs={refs}
          onClose={() => setShowEdit(false)}
          onSaved={load}
        />
      ) : null}

      {showAddTask ? (
        <AddTaskModal
          project={project}
          tasks={tasks}
          refs={refs}
          onClose={() => setShowAddTask(false)}
          onSaved={load}
        />
      ) : null}

      <div className="small muted mt-16">{userById.get(project.responsibleUserId) ? `Responsible: ${userName(refs.users, project.responsibleUserId)}` : ''}</div>
    </div>
  );
}

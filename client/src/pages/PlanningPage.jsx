// Planning page: Gantt timelines for every project (spec section 24).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Card, Icon, Loading, ErrorBlock, Empty, StatusBadge } from '../components/ui.jsx';
import Gantt from '../components/Gantt.jsx';
import { fmtDate } from '../utils.js';

const DONE_PROJECT_STATUSES = ['completed', 'cancelled'];

export default function PlanningPage() {
  const navigate = useNavigate();
  const [projects, setProjects] = useState([]);
  const [tasks, setTasks] = useState(null);
  const [error, setError] = useState('');
  const [scope, setScope] = useState('active');

  const load = useCallback(async () => {
    try {
      const [projectRows, taskRows] = await Promise.all([
        api.get('/projects'),
        api.get('/tasks?all=1')
      ]);
      setProjects(projectRows);
      setTasks(taskRows);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const groups = useMemo(() => {
    if (!tasks) return [];
    const projectById = new Map(projects.map((p) => [p.id, p]));
    const byProject = new Map();
    for (const t of tasks) {
      if (!byProject.has(t.projectId)) byProject.set(t.projectId, []);
      byProject.get(t.projectId).push(t);
    }
    const rows = [];
    for (const [projectId, list] of byProject) {
      const project = projectById.get(projectId);
      if (!project) continue;
      if (scope === 'active' && DONE_PROJECT_STATUSES.includes(project.status)) continue;
      if (scope !== 'active' && scope !== 'all' && project.id !== scope) continue;
      rows.push({ project, tasks: list.sort((a, b) => (a.order || 0) - (b.order || 0)) });
    }
    return rows.sort((a, b) => String(a.project.code).localeCompare(String(b.project.code)));
  }, [tasks, projects, scope]);

  const options = useMemo(
    () => projects.filter((p) => !DONE_PROJECT_STATUSES.includes(p.status) || scope === p.id),
    [projects, scope]
  );

  return (
    <div>
      <div className="page-header">
        <div className="grow">
          <h1>Planning</h1>
          <div className="sub">Planned vs actual timelines per machine project</div>
        </div>
        <div className="flex">
          <select className="select" style={{ width: 280 }} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="active">Active projects only</option>
            <option value="all">All projects</option>
            {options.map((p) => (
              <option key={p.id} value={p.id}>{p.code} — {p.machineName}</option>
            ))}
          </select>
          <button type="button" className="btn btn-secondary" onClick={load}>
            <Icon name="refresh" size={14} /> Refresh
          </button>
        </div>
      </div>

      {error ? <ErrorBlock message={error} /> : null}
      {!tasks ? <Loading /> : groups.length === 0 ? (
        <Empty icon="planning" title="Nothing to plan" hint="Create a project with tasks and planned dates to see the timeline here." />
      ) : (
        groups.map(({ project, tasks: list }) => (
          <Card
            key={project.id}
            className="mb-16"
            title={(
              <span className="flex" style={{ gap: 8, alignItems: 'center' }}>
                {project.code} — {project.machineName}
                <StatusBadge status={project.status} />
              </span>
            )}
            actions={(
              <span className="small muted">
                {fmtDate(project.startDate)} → {fmtDate(project.plannedEndDate)} · {project.progress || 0}%
              </span>
            )}
          >
            <Gantt tasks={list} onOpen={(t) => navigate(`/tasks/${t.id}`)} labelWidth={300} />
          </Card>
        ))
      )}

      {tasks && groups.length > 0 ? (
        <div className="chart-legend">
          <span><span className="dot" style={{ background: '#94a3b8' }} />Planned</span>
          <span><span className="dot" style={{ background: '#1d4ed8' }} />In progress</span>
          <span><span className="dot" style={{ background: '#15803d' }} />Done</span>
          <span><span className="dot" style={{ background: '#b91c1c' }} />Late / blocked</span>
          <span><span className="dot" style={{ background: '#0e7490' }} />Actual</span>
        </div>
      ) : null}
    </div>
  );
}

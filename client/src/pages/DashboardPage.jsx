// Manager dashboard: KPIs + charts (spec sections 19-20).
import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, CartesianGrid, Legend
} from 'recharts';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { Card, Loading, ErrorBlock, Empty, Icon, StatusBadge, PriorityBadge } from '../components/ui.jsx';
import { fmtDate, dueLabel } from '../utils.js';

const PIE_COLORS = ['#1d4ed8', '#0e7490', '#7e22ce', '#15803d', '#b45309', '#b91c1c', '#64748b', '#0891b2'];

function Kpi({ label, value, sub, tone }) {
  return (
    <div className={`kpi-card${tone ? ` tone-${tone}` : ''}`}>
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value ?? '—'}</div>
      {sub ? <div className="kpi-sub">{sub}</div> : null}
    </div>
  );
}

export default function DashboardPage() {
  const { hasPermission } = useAuth();
  const navigate = useNavigate();
  const [data, setData] = useState(null);
  const [my, setMy] = useState(null);
  const [error, setError] = useState('');

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [summary, myDash] = await Promise.all([
          api.get('/dashboard/summary'),
          hasPermission('tasks.view') ? api.get('/dashboard/my') : Promise.resolve(null)
        ]);
        if (alive) { setData(summary); setMy(myDash); }
      } catch (err) {
        if (alive) setError(err.message);
      }
    })();
    return () => { alive = false; };
  }, [hasPermission]);

  if (error) return <ErrorBlock message={error} />;
  if (!data) return <Loading />;

  const { kpis } = data;

  return (
    <div>
      <div className="page-header">
        <div className="grow">
          <h1>Dashboard</h1>
          <div className="sub">Overview of all machine projects and workloads</div>
        </div>
        <Link to="/reports" className="btn btn-secondary"><Icon name="reports" size={15} /> Reports</Link>
        {hasPermission('projects.create') ? (
          <Link to="/projects?new=1" className="btn btn-primary"><Icon name="plus" size={15} /> New project</Link>
        ) : null}
      </div>

      <div className="kpi-grid">
        <Kpi label="Active projects" value={kpis.activeProjects} sub={`${kpis.totalProjects} total`} tone="blue" />
        <Kpi label="Completed" value={kpis.completedProjects} tone="green" />
        <Kpi label="Delayed projects" value={kpis.delayedProjects} tone={kpis.delayedProjects ? 'red' : undefined} />
        <Kpi label="Tasks in progress" value={kpis.tasksInProgress} tone="blue" />
        <Kpi label="Overdue tasks" value={kpis.tasksOverdue} tone={kpis.tasksOverdue ? 'red' : undefined} />
        <Kpi label="Waiting approval" value={kpis.tasksWaitingApproval} tone="amber" />
        <Kpi
          label="Overall completion"
          value={`${kpis.overallCompletion}%`}
          sub={kpis.avgTaskDurationDays !== null ? `avg task duration ${kpis.avgTaskDurationDays} d` : undefined}
          tone="green"
        />
      </div>

      <div className="grid grid-2">
        <Card title="Projects by status" className="chart-card">
          {data.projectsByStatus.every((r) => r.value === 0) ? <Empty title="No projects yet" /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.projectsByStatus} margin={{ top: 5, right: 10, bottom: 5, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8edf5" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={52} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" name="Projects" fill="#1d4ed8" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Projects by type" className="chart-card">
          {data.projectsByType.every((r) => r.value === 0) ? <Empty title="No projects yet" /> : (
            <ResponsiveContainer width="100%" height={240}>
              <PieChart>
                <Pie data={data.projectsByType} dataKey="value" nameKey="name" innerRadius={52} outerRadius={85} paddingAngle={2}>
                  {data.projectsByType.map((entry, index) => (
                    <Cell key={entry.name} fill={PIE_COLORS[index % PIE_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
              </PieChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Tasks by status" className="chart-card">
          {data.tasksByStatus.every((r) => r.value === 0) ? <Empty title="No tasks yet" /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.tasksByStatus} margin={{ top: 5, right: 10, bottom: 5, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8edf5" />
                <XAxis dataKey="name" tick={{ fontSize: 11 }} interval={0} angle={-20} textAnchor="end" height={52} />
                <YAxis allowDecimals={false} tick={{ fontSize: 11 }} />
                <Tooltip />
                <Bar dataKey="value" name="Tasks" fill="#0e7490" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Workload by role" className="chart-card">
          {data.workloadByRole.length === 0 ? <Empty title="No open tasks" /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.workloadByRole} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8edf5" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                <Tooltip />
                <Bar dataKey="value" name="Open tasks" fill="#7e22ce" radius={[0, 5, 5, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Workload by technician" className="chart-card">
          {data.workloadByTechnician.length === 0 ? <Empty title="No assigned tasks" /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.workloadByTechnician} layout="vertical" margin={{ top: 5, right: 20, bottom: 5, left: 30 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8edf5" />
                <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                <YAxis type="category" dataKey="name" tick={{ fontSize: 11 }} width={110} />
                <Tooltip />
                <Bar dataKey="value" name="Open tasks" fill="#15803d" radius={[0, 5, 5, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>

        <Card title="Planned vs actual (days)" className="chart-card">
          {data.plannedVsActual.length === 0 ? <Empty title="No completed tasks yet" /> : (
            <ResponsiveContainer width="100%" height={240}>
              <BarChart data={data.plannedVsActual} margin={{ top: 5, right: 10, bottom: 5, left: -18 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#e8edf5" />
                <XAxis dataKey="name" tick={{ fontSize: 10 }} interval={0} angle={-25} textAnchor="end" height={60} hide />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="planned" name="Planned" fill="#94a3b8" radius={[5, 5, 0, 0]} />
                <Bar dataKey="actual" name="Actual" fill="#1d4ed8" radius={[5, 5, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </Card>
      </div>

      {my ? (
        <div className="grid grid-2">
          <Card
            title={`My open tasks (${my.counts.open})`}
            actions={<Link to="/my-tasks" className="btn btn-ghost btn-sm">Open My Work</Link>}
            bodyClass="card-body tight"
          >
            {(my.buckets.overdue.length + my.buckets.dueToday.length + my.buckets.inProgress.length) === 0 ? (
              <Empty icon="checkCircle" title="Nothing urgent" hint="You have no overdue or in-progress tasks." />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Task</th><th>Project</th><th>Status</th><th>Due</th></tr>
                  </thead>
                  <tbody>
                    {[...my.buckets.overdue, ...my.buckets.dueToday, ...my.buckets.inProgress].slice(0, 8).map((t) => (
                      <tr key={t.id} className="clickable" onClick={() => navigate(`/tasks/${t.id}`)}>
                        <td>{t.name}</td>
                        <td className="muted">{t.machineName}</td>
                        <td><StatusBadge status={t.status} /></td>
                        <td className={t.overdue ? 'strong' : 'muted'} style={t.overdue ? { color: 'var(--red)' } : undefined}>{dueLabel(t.plannedEnd)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>

          <Card
            title={`Approvals to review (${my.counts.toReview})`}
            actions={<Link to="/approvals" className="btn btn-ghost btn-sm">Open Approvals</Link>}
            bodyClass="card-body tight"
          >
            {my.approvalsToReview.length === 0 ? (
              <Empty icon="approvals" title="No pending approvals" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr><th>Machine</th><th>Step / item</th><th>Submitted by</th><th className="right">Action</th></tr>
                  </thead>
                  <tbody>
                    {my.approvalsToReview.slice(0, 8).map((a) => (
                      <tr key={a.id}>
                        <td>{a.machineName}</td>
                        <td className="muted">{a.stepTitle || a.taskName || '—'}</td>
                        <td className="muted">{a.submittedByName}</td>
                        <td className="right">
                          <Link className="btn btn-secondary btn-sm" to={`/tasks/${a.taskId}`}>Review</Link>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>
      ) : null}

      <div className="small muted right">Generated {fmtDate(new Date().toISOString())}</div>
    </div>
  );
}

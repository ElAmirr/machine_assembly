// Technician "My Work" page: buckets by urgency (spec sections 19, 21).
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { Card, Loading, ErrorBlock, StatusBadge, ProgressBar, Empty, Icon } from '../components/ui.jsx';
import { dueLabel, fmtDate } from '../utils.js';

function TaskRow({ task, onOpen }) {
  return (
    <tr className="clickable" onClick={() => onOpen(task.id)}>
      <td>
        <div className="strong">{task.name}</div>
        <div className="small muted">{task.machineName} · {task.projectCode}</div>
      </td>
      <td>{task.stepsTotal > 0 ? <span className="small muted">{task.stepsDone}/{task.stepsTotal} steps</span> : <span className="small muted">no steps</span>}</td>
      <td style={{ minWidth: 110 }}><ProgressBar value={task.progress} /></td>
      <td><StatusBadge status={task.status} /></td>
      <td className={task.overdue ? 'nowrap' : 'nowrap muted'} style={task.overdue ? { color: 'var(--red)', fontWeight: 650 } : undefined}>
        {dueLabel(task.plannedEnd) || fmtDate(task.plannedEnd)}
      </td>
      <td className="actions"><Icon name="chevronRight" size={15} /></td>
    </tr>
  );
}

function Bucket({ title, icon, rows, nav, tone, emptyText }) {
  if (rows.length === 0) {
    return (
      <Card title={`${title} (0)`} bodyClass="card-body tight">
        <Empty icon={icon} title={emptyText || 'Nothing here'} />
      </Card>
    );
  }
  return (
    <Card
      title={`${title} (${rows.length})`}
      bodyClass="card-body tight"
      actions={tone || null}
    >
      <div className="table-wrap">
        <table className="table">
          <thead>
            <tr><th>Task</th><th>Steps</th><th>Progress</th><th>Status</th><th>Due</th><th /></tr>
          </thead>
          <tbody>
            {rows.map((t) => <TaskRow key={t.id} task={t} onOpen={nav} />)}
          </tbody>
        </table>
      </div>
    </Card>
  );
}

export default function MyWorkPage() {
  const [data, setData] = useState(null);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(true);
  const navigate = useNavigate();

  const load = useCallback(async () => {
    try {
      setData(await api.get('/dashboard/my'));
      setError('');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <Loading />;
  if (error) return <ErrorBlock message={error} />;
  if (!data) return null;

  const open = (id) => navigate(`/tasks/${id}`);

  return (
    <div>
      <div className="page-header">
        <div className="grow">
          <h1>My Work</h1>
          <div className="sub">{data.counts.open} open task(s) assigned to you</div>
        </div>
        <button type="button" className="btn btn-secondary" onClick={load}><Icon name="refresh" size={15} /> Refresh</button>
        <Link to="/tasks" className="btn btn-secondary"><Icon name="list" size={15} /> All tasks</Link>
      </div>

      <div className="kpi-grid">
        <div className={`kpi-card${data.counts.overdue ? ' tone-red' : ''}`}>
          <div className="kpi-label">Overdue</div>
          <div className="kpi-value">{data.counts.overdue}</div>
        </div>
        <div className="kpi-card tone-amber">
          <div className="kpi-label">Due today</div>
          <div className="kpi-value">{data.counts.dueToday}</div>
        </div>
        <div className="kpi-card tone-blue">
          <div className="kpi-label">In progress</div>
          <div className="kpi-value">{data.counts.inProgress}</div>
        </div>
        <div className="kpi-card tone-amber">
          <div className="kpi-label">Waiting approval</div>
          <div className="kpi-value">{data.counts.waitingApproval}</div>
        </div>
        {data.counts.toReview > 0 ? (
          <div className="kpi-card tone-green">
            <div className="kpi-label">To review</div>
            <div className="kpi-value">{data.counts.toReview}</div>
            <Link to="/approvals" className="small">Open approvals →</Link>
          </div>
        ) : null}
      </div>

      {data.counts.overdue > 0 ? (
        <Bucket title="Overdue" icon="alert" rows={data.buckets.overdue} nav={open} emptyText="Nothing overdue" />
      ) : null}
      <Bucket title="Due today" icon="clock" rows={data.buckets.dueToday} nav={open} emptyText="Nothing due today" />
      <Bucket title="In progress" icon="play" rows={data.buckets.inProgress} nav={open} emptyText="Nothing in progress" />
      <Bucket title="Waiting approval" icon="approvals" rows={data.buckets.waitingApproval} nav={open} emptyText="Nothing waiting for approval" />
      <Bucket title="Up next" icon="list" rows={data.buckets.upNext} nav={open} emptyText="No upcoming tasks" />
      <Bucket title="Recently completed" icon="checkCircle" rows={data.buckets.recentlyCompleted} nav={open} emptyText="Nothing completed yet" />
    </div>
  );
}

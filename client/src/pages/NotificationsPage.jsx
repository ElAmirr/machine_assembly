// Notifications inbox (spec section 26).
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { Card, Icon, Loading, ErrorBlock, Empty } from '../components/ui.jsx';
import { fmtRelative } from '../utils.js';
import { classNames } from '../utils.js';

const TYPE_ICONS = {
  approval_requested: 'approvals',
  step_approved: 'checkCircle',
  step_rejected: 'alert',
  task_assigned: 'tasks',
  task_completed: 'checkCircle',
  due_soon: 'clock',
  overdue: 'alert',
  comment: 'comment'
};

export default function NotificationsPage() {
  const navigate = useNavigate();
  const { show } = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      setRows(await api.get('/notifications'));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const unread = (rows || []).filter((n) => n.read !== true).length;

  const open = async (n) => {
    if (n.read !== true) {
      try {
        await api.post(`/notifications/${n.id}/read`);
        setRows((list) => list.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      } catch { /* ignore */ }
    }
    if (n.link) navigate(n.link);
  };

  const markAll = async () => {
    try {
      await api.post('/notifications/read-all');
      setRows((list) => list.map((x) => ({ ...x, read: true })));
      show('All notifications marked as read', 'success');
    } catch (err) {
      show(err.message, 'error');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="grow">
          <h1>Notifications</h1>
          <div className="sub">{rows ? `${unread} unread of ${rows.length}` : 'Your activity feed'}</div>
        </div>
        {unread > 0 ? (
          <button type="button" className="btn btn-secondary" onClick={markAll}>
            <Icon name="check" size={14} /> Mark all read
          </button>
        ) : null}
      </div>

      {error ? <ErrorBlock message={error} /> : null}
      {!rows ? <Loading /> : rows.length === 0 ? (
        <Empty icon="bell" title="No notifications" hint="You will be notified about approvals, assignments and deadlines." />
      ) : (
        <Card bodyClass="card-body">
          {rows.map((n) => (
            <div
              key={n.id}
              className={classNames('notif-item', n.read !== true && 'unread')}
              style={{ cursor: n.link ? 'pointer' : 'default' }}
              onClick={() => open(n)}
            >
              <span className="icon-btn" style={{ pointerEvents: 'none' }}>
                <Icon name={TYPE_ICONS[n.type] || 'bell'} size={16} />
              </span>
              <div className="grow">
                <div className="strong">{n.title}</div>
                <div className="small">{n.message}</div>
                <div className="small muted">{fmtRelative(n.createdAt)}</div>
              </div>
              {n.read !== true ? <span className="badge-dot" style={{ background: 'var(--primary)' }} /> : null}
            </div>
          ))}
        </Card>
      )}
    </div>
  );
}

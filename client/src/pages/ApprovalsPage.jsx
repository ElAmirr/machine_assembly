// Approvals queue: review submitted steps and tasks (spec section 15).
import { useCallback, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Card, Icon, Loading, ErrorBlock, Empty, StatusBadge, Modal, Field } from '../components/ui.jsx';
import { fmtDateTime } from '../utils.js';
import { classNames } from '../utils.js';

function ReviewModal({ approval, mode, onClose, onDone }) {
  const { show } = useToast();
  const isReject = mode === 'reject';
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (isReject && !reason.trim()) { setError('A rejection reason is required.'); return; }
    setBusy(true);
    try {
      await api.post(`/approvals/${approval.id}/${isReject ? 'reject' : 'approve'}`, { reason: reason.trim() });
      show(isReject ? 'Work rejected' : 'Work approved', 'success');
      onDone?.();
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  const label = approval.scope === 'step' ? `step "${approval.stepTitle}" of task "${approval.taskName}"` : `task "${approval.taskName}"`;
  return (
    <Modal
      title={isReject ? 'Reject work' : 'Approve work'}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="approval-review-form" className={isReject ? 'btn btn-danger' : 'btn btn-success'} disabled={busy}>
            {busy ? 'Working…' : isReject ? 'Reject' : 'Approve'}
          </button>
        </>
      )}
    >
      <form id="approval-review-form" onSubmit={submit}>
        {error ? <div className="error-block">{error}</div> : null}
        <p className="small">
          {approval.machineName || ''} — you are reviewing {label}, submitted by <strong>{approval.submittedByName || '—'}</strong> on {fmtDateTime(approval.submittedAt)}.
        </p>
        <Field label={isReject ? 'Rejection reason *' : 'Comment (optional)'}>
          <textarea className="textarea" rows="3" value={reason} onChange={(e) => setReason(e.target.value)} autoFocus
            placeholder={isReject ? 'Explain what must be corrected…' : 'Optional approval note…'} />
        </Field>
      </form>
    </Modal>
  );
}

export default function ApprovalsPage() {
  const { hasPermission } = useAuth();
  const { show } = useToast();
  const [rows, setRows] = useState(null);
  const [error, setError] = useState('');
  const [status, setStatus] = useState('submitted');
  const [scope, setScope] = useState('');
  const [mine, setMine] = useState(false);
  const [review, setReview] = useState(null);

  const load = useCallback(async () => {
    try {
      const qs = new URLSearchParams();
      if (status) qs.set('status', status);
      if (scope) qs.set('scope', scope);
      if (mine) qs.set('mine', '1');
      setRows(await api.get(`/approvals?${qs.toString()}`));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [status, scope, mine]);

  useEffect(() => { load(); }, [load]);

  const canApprove = hasPermission('approvals.approve');

  return (
    <div>
      <div className="page-header">
        <div className="grow">
          <h1>Approvals</h1>
          <div className="sub">{rows ? `${rows.length} request(s)` : 'Review submitted work'}</div>
        </div>
        <div className="flex">
          <select className="select" style={{ width: 170 }} value={status} onChange={(e) => setStatus(e.target.value)}>
            <option value="submitted">Pending</option>
            <option value="approved">Approved</option>
            <option value="rejected">Rejected</option>
            <option value="">All</option>
          </select>
          <select className="select" style={{ width: 150 }} value={scope} onChange={(e) => setScope(e.target.value)}>
            <option value="">Steps & tasks</option>
            <option value="step">Steps only</option>
            <option value="task">Tasks only</option>
          </select>
          <label className="checkbox-row">
            <input type="checkbox" checked={mine} onChange={(e) => setMine(e.target.checked)} />
            My submissions
          </label>
        </div>
      </div>

      {error ? <ErrorBlock message={error} /> : null}
      {!rows ? <Loading /> : rows.length === 0 ? (
        <Empty icon="approvals" title="Nothing to review" hint="Submitted steps and tasks will appear here." />
      ) : (
        <Card bodyClass="card-body tight">
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Work item</th>
                  <th>Machine</th>
                  <th>Submitted by</th>
                  <th>Submitted</th>
                  <th>Status</th>
                  <th>Reviewed</th>
                  <th className="actions" />
                </tr>
              </thead>
              <tbody>
                {rows.map((a) => (
                  <tr key={a.id}>
                    <td>
                      <div className="strong">{a.scope === 'step' ? a.stepTitle : a.taskName}</div>
                      <div className="small muted">
                        {a.scope === 'step' ? `step of "${a.taskName}"` : 'Task approval'}
                        {a.taskId ? <> · <Link to={`/tasks/${a.taskId}`}>open task</Link></> : null}
                      </div>
                      {a.reason ? <div className="small" style={{ color: 'var(--red)' }}>Reason: {a.reason}</div> : null}
                    </td>
                    <td className="muted nowrap">
                      {a.machineName || '—'}
                      <div className="small">{a.projectCode || ''}</div>
                    </td>
                    <td className="muted">{a.submittedByName || '—'}</td>
                    <td className="small muted nowrap">{fmtDateTime(a.submittedAt)}</td>
                    <td><StatusBadge status={a.status} /></td>
                    <td className="small muted nowrap">
                      {a.reviewedAt ? <>{a.reviewedByName || '—'}<div>{fmtDateTime(a.reviewedAt)}</div></> : '—'}
                    </td>
                    <td className="actions">
                      {a.status === 'submitted' && canApprove ? (
                        <div className="flex" style={{ gap: 6, justifyContent: 'flex-end' }}>
                          <button type="button" className="btn btn-success btn-sm" onClick={() => setReview({ approval: a, mode: 'approve' })}>Approve</button>
                          <button type="button" className={classNames('btn', 'btn-danger-outline', 'btn-sm')} onClick={() => setReview({ approval: a, mode: 'reject' })}>Reject</button>
                        </div>
                      ) : null}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {review ? (
        <ReviewModal approval={review.approval} mode={review.mode} onClose={() => setReview(null)} onDone={load} />
      ) : null}
    </div>
  );
}

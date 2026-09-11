// Task execution page: step-by-step work, evidence upload, approvals, comments (spec sections 7-15, 27, 33-36).
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import {
  Card, Icon, Loading, ErrorBlock, Empty, StatusBadge, ProgressBar, Modal, Field, AuthImage
} from '../components/ui.jsx';
import AttachmentsPanel from '../components/AttachmentsPanel.jsx';
import CommentsPanel from '../components/CommentsPanel.jsx';
import { fmtDate, fmtDateTime, fmtRelative, fmtBytes, classNames, durationText } from '../utils.js';

function isImageAtt(att) {
  return String(att?.mimeType || '').startsWith('image/') ||
    ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.bmp'].includes(String(att?.ext || '').toLowerCase());
}

// Evidence catalog entries: seeded rows use key/label, admin-created rows use code/name.
const evKey = (t) => t?.key || t?.code || t?.name;
const evLabel = (t) => t?.label || t?.name || t?.code;

function reqItemName(row, map) {
  const key = row.materialId || row.componentId || row.toolId;
  return map.get(key)?.name || '—';
}

function ReqChips({ icon, label, rows, map }) {
  if (!rows || rows.length === 0) return null;
  return (
    <div className="small" style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
      <span className="muted flex" style={{ gap: 4, alignItems: 'center' }}><Icon name={icon} size={13} />{label}:</span>
      {rows.map((r, i) => (
        <span className="badge badge-slate" key={i}>
          {reqItemName(r, map)}
          {r.quantity > 1 ? ` × ${r.quantity}${r.unit ? ` ${r.unit}` : ''}` : ''}
        </span>
      ))}
    </div>
  );
}

// ------------------------------------------------------------------ evidence display

function EvidenceItem({ e, typeByKey, canDelete, onDelete }) {
  const t = typeByKey.get(e.type);
  const att = e.attachment;
  const m = e.measurement;
  return (
    <div className="evidence-item">
      <div className="evidence-thumb">
        {att && isImageAtt(att)
          ? <AuthImage attachmentId={att.id} alt={att.filename} />
          : <Icon name={t?.kind === 'measurement' ? 'planning' : t?.kind === 'checklist' ? 'list' : att ? 'file' : 'comment'} size={18} />}
      </div>
      <div className="grow" style={{ minWidth: 0 }}>
        <div className="strong">
          {evLabel(t) || e.type}
          {m?.result ? (
            <span className={classNames('badge', m.result === 'pass' ? 'badge-green' : 'badge-red')} style={{ marginLeft: 7 }}>
              {m.result === 'pass' ? 'PASS' : 'FAIL'}
            </span>
          ) : null}
        </div>
        {att ? (
          <div className="small muted" style={{ overflowWrap: 'anywhere' }}>
            {att.filename} · {fmtBytes(att.size)}
          </div>
        ) : null}
        {m ? (
          <div className="small">
            <span className="muted">{m.name || 'Measurement'}:</span>{' '}
            <span className="strong">{m.value} {m.unit || ''}</span>
            {m.expected !== null && m.expected !== undefined ? (
              <span className="muted"> (expected {m.expected} ± {m.tolerance ?? 0} {m.unit || ''})</span>
            ) : null}
          </div>
        ) : null}
        {e.checklist && e.checklist.length > 0 ? (
          <div className="small" style={{ marginTop: 2 }}>
            {e.checklist.map((c, i) => (
              <div key={i} className="checklist-row" style={{ padding: '2px 0' }}>
                <Icon name={c.checked ? 'checkCircle' : 'x'} size={13} style={{ color: c.checked ? 'var(--green)' : 'var(--red)' }} />
                <span>{c.label}</span>
              </div>
            ))}
          </div>
        ) : null}
        {e.comment ? <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{e.comment}</div> : null}
        {e.description ? <div className="small muted">{e.description}</div> : null}
        <div className="small muted" style={{ marginTop: 4 }}>{e.createdByName || '—'} · {fmtRelative(e.createdAt)}</div>
      </div>
      <div className="flex" style={{ flexShrink: 0 }}>
        {att ? (
          <a className="icon-btn" title="Download" href={api.fileUrl(att.id, false)}>
            <Icon name="download" size={15} />
          </a>
        ) : null}
        {canDelete ? (
          <button type="button" className="icon-btn" title="Remove evidence" onClick={() => onDelete(e)}>
            <Icon name="trash" size={15} />
          </button>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ add evidence modal

function EvidenceModal({ taskId, step, typeRows, onClose, onSaved }) {
  const { show } = useToast();
  const allowed = useMemo(
    () => (step.evidenceTypes && step.evidenceTypes.length > 0
      ? typeRows.filter((t) => step.evidenceTypes.includes(evKey(t)))
      : typeRows),
    [step, typeRows]
  );
  const [typeKey, setTypeKey] = useState(evKey(allowed[0]) || 'photo');
  const kind = allowed.find((t) => evKey(t) === typeKey)?.kind || 'file';
  const accept = allowed.find((t) => evKey(t) === typeKey)?.accept || '';
  const cfg = step.measurement || {};

  const [file, setFile] = useState(null);
  const [description, setDescription] = useState('');
  const [comment, setComment] = useState('');
  const [measurement, setMeasurement] = useState({
    name: cfg.name || '', expected: cfg.expected ?? '', tolerance: cfg.tolerance ?? '', unit: cfg.unit || '', value: ''
  });
  const [checklist, setChecklist] = useState([{ label: '', checked: true }]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const preview = useMemo(() => {
    const exp = Number(measurement.expected);
    const val = Number(measurement.value);
    if (measurement.expected === '' || measurement.value === '' || !Number.isFinite(exp) || !Number.isFinite(val)) return null;
    const tol = Math.abs(Number(measurement.tolerance) || 0);
    return Math.abs(val - exp) <= tol ? 'pass' : 'fail';
  }, [measurement]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (kind === 'file' && !file) { setError('Select a file to upload.'); return; }
    if (kind === 'measurement' && measurement.value === '') { setError('Measurement value is required.'); return; }
    if (kind === 'comment' && !comment.trim()) { setError('Comment text is required.'); return; }
    if (kind === 'checklist' && checklist.filter((c) => c.label.trim()).length === 0) { setError('Add at least one checklist item.'); return; }
    setBusy(true);
    try {
      const fd = new FormData();
      fd.append('type', typeKey);
      if (description.trim()) fd.append('description', description.trim());
      if (kind === 'file') fd.append('file', file);
      if (kind === 'measurement') {
        const payload = { name: measurement.name.trim(), unit: measurement.unit.trim(), value: Number(measurement.value) };
        if (measurement.expected !== '') payload.expected = Number(measurement.expected);
        if (measurement.tolerance !== '') payload.tolerance = Math.abs(Number(measurement.tolerance)) || 0;
        fd.append('measurement', JSON.stringify(payload));
      }
      if (kind === 'checklist') {
        fd.append('checklist', JSON.stringify(checklist.filter((c) => c.label.trim())));
      }
      if (kind === 'comment') fd.append('comment', comment.trim());
      await api.upload(`/tasks/${taskId}/steps/${step.id}/evidence`, fd);
      show('Evidence saved', 'success');
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
      title={`Add evidence — ${step.title}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="evidence-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : 'Save evidence'}
          </button>
        </>
      )}
    >
      <form id="evidence-form" onSubmit={submit}>
        {error ? <div className="error-block">{error}</div> : null}
        <div className="input-row">
          <Field label="Evidence type *">
            <select className="select" value={typeKey} onChange={(e) => setTypeKey(e.target.value)}>
              {allowed.map((t) => <option key={evKey(t)} value={evKey(t)}>{evLabel(t)}</option>)}
            </select>
          </Field>
          <Field label="Description">
            <input className="input" value={description} onChange={(e) => setDescription(e.target.value)} placeholder="Optional note about this evidence" />
          </Field>
        </div>

        {kind === 'file' ? (
          <Field label="File *" hint={accept ? `Accepted: ${accept}` : 'Any file type'}>
            <input type="file" className="input" accept={accept} onChange={(e) => setFile(e.target.files?.[0] || null)} />
            {file ? <div className="small muted" style={{ marginTop: 4 }}>{file.name} · {fmtBytes(file.size)}</div> : null}
          </Field>
        ) : null}

        {kind === 'measurement' ? (
          <div>
            {cfg.enabled ? (
              <div className="info-block small mb-8">
                Required range: <strong>{cfg.name || 'measurement'} = {cfg.expected ?? '—'} ± {cfg.tolerance ?? 0} {cfg.unit || ''}</strong>
                {cfg.required ? ' — a PASS measurement is needed to complete the step.' : ''}
              </div>
            ) : null}
            <div className="input-row">
              <Field label="Name">
                <input className="input" value={measurement.name} onChange={(e) => setMeasurement((m) => ({ ...m, name: e.target.value }))} />
              </Field>
              <Field label="Unit">
                <input className="input" value={measurement.unit} onChange={(e) => setMeasurement((m) => ({ ...m, unit: e.target.value }))} placeholder="mm, V, bar…" />
              </Field>
            </div>
            <div className="input-row">
              <Field label="Expected value">
                <input type="number" step="any" className="input" value={measurement.expected} onChange={(e) => setMeasurement((m) => ({ ...m, expected: e.target.value }))} />
              </Field>
              <Field label="Tolerance ±">
                <input type="number" step="any" className="input" value={measurement.tolerance} onChange={(e) => setMeasurement((m) => ({ ...m, tolerance: e.target.value }))} />
              </Field>
              <Field label="Measured value *">
                <input type="number" step="any" className="input" value={measurement.value} onChange={(e) => setMeasurement((m) => ({ ...m, value: e.target.value }))} autoFocus />
              </Field>
            </div>
            {preview ? (
              <div className={preview === 'pass' ? 'info-block' : 'warning-block'}>
                Result preview: <strong>{preview === 'pass' ? 'PASS — within tolerance' : 'FAIL — outside tolerance'}</strong>
              </div>
            ) : null}
          </div>
        ) : null}

        {kind === 'checklist' ? (
          <Field label="Checklist items *">
            <div>
              {checklist.map((c, i) => (
                <div className="flex" key={i} style={{ marginBottom: 6 }}>
                  <label className="checklist-row" style={{ flexShrink: 0 }}>
                    <input
                      type="checkbox"
                      checked={c.checked}
                      onChange={(e) => setChecklist((rows) => rows.map((r, j) => (j === i ? { ...r, checked: e.target.checked } : r)))}
                    />
                  </label>
                  <input
                    className="input"
                    value={c.label}
                    placeholder={`Item ${i + 1}`}
                    onChange={(e) => setChecklist((rows) => rows.map((r, j) => (j === i ? { ...r, label: e.target.value } : r)))}
                  />
                  <button type="button" className="icon-btn" onClick={() => setChecklist((rows) => rows.filter((_, j) => j !== i))}>
                    <Icon name="trash" size={15} />
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setChecklist((rows) => [...rows, { label: '', checked: true }])}>
                <Icon name="plus" size={13} /> Add item
              </button>
            </div>
          </Field>
        ) : null}

        {kind === 'comment' ? (
          <Field label="Comment *">
            <textarea className="textarea" rows="4" value={comment} onChange={(e) => setComment(e.target.value)} placeholder="Describe what was done, checked or observed…" />
          </Field>
        ) : null}
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ complete step/task modal

function CompleteModal({ title, path, approvalRequired, canOverride, onClose, onSaved }) {
  const { show } = useToast();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [problems, setProblems] = useState([]);

  const run = async (force) => {
    setBusy(true);
    setError('');
    try {
      await api.post(path, { note, force });
      show(force ? 'Completed with override' : approvalRequired ? 'Submitted for approval' : 'Completed', 'success');
      onSaved?.();
      onClose();
    } catch (err) {
      setError(err.message);
      if (Array.isArray(err.details) && err.details.length > 0) setProblems(err.details);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          {problems.length > 0 && canOverride ? (
            <button type="button" className="btn btn-danger-outline" disabled={busy} onClick={() => run(true)}>
              Complete anyway (override)
            </button>
          ) : null}
          <button type="button" className="btn btn-primary" disabled={busy} onClick={() => run(false)}>
            {busy ? 'Working…' : approvalRequired ? 'Submit for approval' : 'Complete'}
          </button>
        </>
      )}
    >
      {error ? <div className="error-block">{error}</div> : null}
      {problems.length > 0 ? (
        <div className="warning-block mb-16">
          <div className="strong mb-8">Requirements not met:</div>
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {problems.map((p, i) => <li key={i} className="small">{p}</li>)}
          </ul>
          {canOverride ? <div className="small mt-8">You can override with your manager permission.</div> : null}
        </div>
      ) : null}
      {approvalRequired ? (
        <div className="info-block mb-16">This work requires approval after completion — it will be submitted to the approvers.</div>
      ) : null}
      <Field label="Completion note">
        <textarea className="textarea" rows="3" value={note} onChange={(e) => setNote(e.target.value)} placeholder="What was done, remarks, deviations…" />
      </Field>
    </Modal>
  );
}

// ------------------------------------------------------------------ approval review modal

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

  return (
    <Modal
      title={isReject ? 'Reject work' : 'Approve work'}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="review-form" className={isReject ? 'btn btn-danger' : 'btn btn-success'} disabled={busy}>
            {busy ? 'Working…' : isReject ? 'Reject' : 'Approve'}
          </button>
        </>
      )}
    >
      <form id="review-form" onSubmit={submit}>
        {error ? <div className="error-block">{error}</div> : null}
        <p className="small">
          {approval.scope === 'step' ? `Step "${approval.stepTitle}"` : `Task`} — submitted by <strong>{approval.submittedByName || '—'}</strong> on {fmtDateTime(approval.submittedAt)}
        </p>
        <Field label={isReject ? 'Rejection reason *' : 'Comment (optional)'}>
          <textarea className="textarea" rows="3" value={reason} onChange={(e) => setReason(e.target.value)} placeholder={isReject ? 'Explain what must be corrected…' : 'Optional approval note…'} autoFocus />
        </Field>
      </form>
    </Modal>
  );
}

// ------------------------------------------------------------------ step block

function StepBlock({ task, step, index, refs, evidence, permissions, locked, onReload }) {
  const { user, hasPermission } = useAuth();
  const { show, confirm } = useToast();
  const [showAdd, setShowAdd] = useState(false);
  const [showComplete, setShowComplete] = useState(false);
  const [busy, setBusy] = useState(false);

  const done = step.status === 'completed';
  const submitted = step.status === 'submitted';
  const isCurrent = !done && !submitted && task.status !== 'submitted';
  const workable = permissions.canWork && !done && !submitted &&
    !['submitted', 'completed', 'approved', 'cancelled'].includes(task.status);
  const canOverride = hasPermission('tasks.override');
  const canUpload = hasPermission('attachments.upload');
  const canManageEvidence = hasPermission(['attachments.manage']);
  const m = step.measurement || {};
  const typeByKey = useMemo(() => new Map(refs.evidenceTypes.map((t) => [evKey(t), t])), [refs.evidenceTypes]);

  const startStep = async () => {
    setBusy(true);
    try {
      await api.post(`/tasks/${task.id}/steps/${step.id}/start`, {});
      show('Step started', 'success');
      onReload();
    } catch (err) {
      show(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const removeEvidence = async (ev) => {
    const ok = await confirm({
      title: 'Remove this evidence?',
      message: 'The evidence record and its uploaded file will be permanently deleted.',
      confirmLabel: 'Remove'
    });
    if (!ok) return;
    try {
      await api.del(`/evidence/${ev.id}`);
      show('Evidence removed', 'success');
      onReload();
    } catch (err) {
      show(err.message, 'error');
    }
  };

  const canDeleteEvidence = (ev) =>
    (ev.createdBy === user?.id || canManageEvidence) && (!done && !submitted || canManageEvidence);

  return (
    <div className={classNames('card')} style={{ marginBottom: 14, opacity: locked ? 0.72 : 1 }}>
      <div className="card-body">
        <div className="flex between" style={{ alignItems: 'flex-start', gap: 10 }}>
          <div className="flex grow" style={{ gap: 10, alignItems: 'flex-start' }}>
            <span className={classNames('step-num', done && 'done', isCurrent && 'current')}>
              {done ? <Icon name="check" size={13} /> : locked ? <Icon name="eye" size={13} /> : index + 1}
            </span>
            <div className="grow">
              <div className="strong" style={{ fontSize: 14.5 }}>
                {step.title}{' '}
                <StatusBadge status={step.status} kind="step" label={(refs.statuses?.step || []).find((s) => s.key === step.status)?.label} />
                {step.approvalRequired ? <span className="badge badge-purple" style={{ marginLeft: 6 }}>approval</span> : null}
              </div>
              <div className="step-meta small muted">
                {durationText(step.estimatedDuration, step.durationUnit)}
                {evidence.length > 0 ? ` · ${evidence.length} evidence item(s)` : ''}
                {step.completedAt ? ` · completed ${fmtDateTime(step.completedAt)}` : ''}
                {step.startedAt && !step.completedAt ? ` · started ${fmtRelative(step.startedAt)}` : ''}
              </div>
            </div>
          </div>
          <div className="flex" style={{ flexShrink: 0, gap: 6 }}>
            {workable && !locked && (step.status !== 'in_progress') ? (
              <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={startStep}>
                <Icon name="play" size={13} /> {step.status === 'rejected' ? 'Resume' : 'Start'}
              </button>
            ) : null}
            {workable && canUpload ? (
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setShowAdd(true)}>
                <Icon name="camera" size={13} /> Evidence
              </button>
            ) : null}
            {workable && (step.status === 'in_progress' || step.status === 'rejected' || step.status === 'waiting' || step.status === 'blocked') ? (
              <button
                type="button"
                className="btn btn-success btn-sm"
                disabled={locked && !canOverride}
                title={locked && !canOverride ? 'Locked until the previous step is completed' : ''}
                onClick={() => setShowComplete(true)}
              >
                <Icon name="check" size={13} /> Complete
              </button>
            ) : null}
          </div>
        </div>

        {locked && !canOverride ? (
          <div className="warning-block small mt-8">
            <Icon name="alert" size={13} /> Locked — complete the previous step first (sequential steps).
          </div>
        ) : null}

        {step.rejectionReason ? (
          <div className="warning-block mt-8">
            <div className="strong">Rejected — correction needed</div>
            <div className="small">{step.rejectionReason}</div>
          </div>
        ) : null}

        {submitted ? (
          <div className="info-block small mt-8">
            <Icon name="clock" size={13} /> Waiting for approval — evidence cannot be changed.
          </div>
        ) : null}

        {step.description ? <div className="small mt-8" style={{ whiteSpace: 'pre-wrap' }}>{step.description}</div> : null}
        {step.instructions ? <div className="instruction-box">{step.instructions}</div> : null}

        {(step.materials?.length || step.components?.length || step.tools?.length) ? (
          <div className="mt-8" style={{ display: 'flex', flexDirection: 'column', gap: 5 }}>
            <ReqChips icon="materials" label="Materials" rows={step.materials} map={new Map(refs.materials.map((x) => [x.id, x]))} />
            <ReqChips icon="components" label="Components" rows={step.components} map={new Map(refs.components.map((x) => [x.id, x]))} />
            <ReqChips icon="tools" label="Tools" rows={step.tools} map={new Map(refs.tools.map((x) => [x.id, x]))} />
          </div>
        ) : null}

        <div className="flex flex-wrap small muted mt-8" style={{ gap: 8 }}>
          {step.evidenceRequired ? (
            <span className="badge badge-blue">
              evidence: {step.minFiles || 1}{(step.maxFiles ? `–${step.maxFiles}` : '+')} file(s)
            </span>
          ) : null}
          {(step.evidenceTypes || []).map((k) => (
            <span className="badge badge-slate" key={k}>{evLabel(typeByKey.get(k)) || k}</span>
          ))}
          {m.enabled ? (
            <span className="badge badge-cyan">
              measure {m.name || ''} {m.expected ?? '—'} ± {m.tolerance ?? 0} {m.unit || ''}{m.required ? ' (required)' : ''}
            </span>
          ) : null}
          {step.completionNote ? <span className="badge badge-green">note: {step.completionNote}</span> : null}
        </div>

        {evidence.length > 0 ? (
          <div style={{ marginTop: 10 }}>
            {evidence.map((ev) => (
              <EvidenceItem
                key={ev.id}
                e={ev}
                typeByKey={typeByKey}
                canDelete={canDeleteEvidence(ev)}
                onDelete={removeEvidence}
              />
            ))}
          </div>
        ) : step.evidenceRequired ? (
          <div className="small muted" style={{ marginTop: 8 }}>No evidence yet — at least {step.minFiles || 1} file(s) required before completion.</div>
        ) : null}
      </div>

      {showAdd ? (
        <EvidenceModal
          taskId={task.id}
          step={step}
          typeRows={refs.evidenceTypes.filter((t) => t.active !== false)}
          onClose={() => setShowAdd(false)}
          onSaved={onReload}
        />
      ) : null}

      {showComplete ? (
        <CompleteModal
          title={`Complete step — ${step.title}`}
          path={`/tasks/${task.id}/steps/${step.id}/complete`}
          approvalRequired={!!step.approvalRequired}
          canOverride={canOverride}
          onClose={() => setShowComplete(false)}
          onSaved={onReload}
        />
      ) : null}
    </div>
  );
}

// ------------------------------------------------------------------ page

export default function TaskPage() {
  const { id } = useParams();
  const { hasPermission, meta } = useAuth();
  const { show } = useToast();

  const [detail, setDetail] = useState(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [showTaskComplete, setShowTaskComplete] = useState(false);
  const [review, setReview] = useState(null);

  const load = useCallback(async () => {
    try {
      setDetail(await api.get(`/tasks/${id}`));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [id]);

  useEffect(() => { load(); }, [load]);

  const evidenceByStep = useMemo(() => {
    const m = new Map();
    for (const e of detail?.evidence || []) {
      if (!m.has(e.stepId)) m.set(e.stepId, []);
      m.get(e.stepId).push(e);
    }
    return m;
  }, [detail]);

  if (error) return <ErrorBlock message={error} />;
  if (!detail) return <Loading />;

  const { task, project, refs, permissions, approvals, comments, attachments } = detail;
  const steps = [...(task.steps || [])].sort((a, b) => (a.order || 0) - (b.order || 0));
  const doneTask = ['completed', 'approved'].includes(task.status);
  const taskSubmitted = task.status === 'submitted';
  const canOverride = hasPermission('tasks.override');
  const canEditTask = permissions.canEdit || hasPermission('tasks.edit');
  const canCompleteTask = permissions.canWork && !doneTask && !taskSubmitted &&
    hasPermission(['tasks.complete']);
  const taskStatusLabel = (k) => (refs.statuses?.task || []).find((s) => s.key === k)?.label || k;
  const pendingApprovals = (approvals || []).filter((a) => a.status === 'submitted');
  const sortedApprovals = [...(approvals || [])].sort((a, b) => {
    if (a.status === 'submitted' && b.status !== 'submitted') return -1;
    if (b.status === 'submitted' && a.status !== 'submitted') return 1;
    return String(b.submittedAt).localeCompare(String(a.submittedAt));
  });

  const startTask = async () => {
    setBusy(true);
    try {
      await api.post(`/tasks/${task.id}/start`, {});
      show('Task started', 'success');
      load();
    } catch (err) {
      show(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const setStatus = async (status) => {
    try {
      await api.post(`/tasks/${task.id}/status`, { status });
      show(`Task marked as ${taskStatusLabel(status)}`, 'success');
      load();
    } catch (err) {
      show(err.message, 'error');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="grow">
          <Link to={`/projects/${project?.id}`} className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="back" size={13} /> {project?.machineName || 'Project'} {project?.code ? `(${project.code})` : ''}
          </Link>
          <h1>
            <span className="muted" style={{ fontWeight: 400 }}>{task.order ? `${task.order}. ` : ''}</span>
            {task.name}
          </h1>
          <div className="flex flex-wrap sub" style={{ gap: 8 }}>
            <StatusBadge status={task.status} label={taskStatusLabel(task.status)} />
            {task.approvalRequired ? <span className="badge badge-purple">needs approval</span> : null}
            {task.roleName ? <span className="muted">{task.roleName}</span> : null}
            {task.assignedName ? <span className="muted">· {task.assignedName}</span> : null}
            {task.plannedEnd ? <span className="muted">· plan {fmtDate(task.plannedStart)} → {fmtDate(task.plannedEnd)}</span> : null}
          </div>
        </div>
        <div className="flex flex-wrap">
          {canCompleteTask && ['not_started', 'ready', 'waiting', 'blocked', 'rejected'].includes(task.status) && hasPermission('tasks.complete') ? (
            <button type="button" className="btn btn-primary" disabled={busy} onClick={startTask}>
              <Icon name="play" size={14} /> Start task
            </button>
          ) : null}
          {canCompleteTask ? (
            <button type="button" className="btn btn-success" onClick={() => setShowTaskComplete(true)}>
              <Icon name="check" size={14} /> Complete task
            </button>
          ) : null}
          {canEditTask && !doneTask && !taskSubmitted ? (
            <div className="flex" style={{ gap: 6 }}>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStatus('waiting')}>Waiting</button>
              <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStatus('blocked')}>Blocked</button>
              {task.status !== 'in_progress' ? (
                <button type="button" className="btn btn-secondary btn-sm" onClick={() => setStatus('in_progress')}>Resume</button>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>

      <Card className="mb-16">
        <div className="flex between mb-8">
          <span className="small muted">Task progress</span>
          <span className="strong">{task.progress || 0}% · {task.stepsDone}/{task.stepsTotal} steps done</span>
        </div>
        <ProgressBar value={task.progress} />
      </Card>

      <div className="split">
        <div className="col">
          <Card title={`Steps (${steps.length})`} bodyClass="card-body">
            {steps.length === 0 ? (
              <Empty icon="tasks" title="This task has no steps" hint="Complete the task directly when the work is done." />
            ) : (
              steps.map((step, i) => {
                const locked = task.sequentialSteps !== false && i > 0 && steps[i - 1].status !== 'completed';
                return (
                  <StepBlock
                    key={step.id}
                    task={task}
                    step={step}
                    index={i}
                    refs={refs}
                    evidence={evidenceByStep.get(step.id) || []}
                    permissions={permissions}
                    locked={locked}
                    onReload={load}
                  />
                );
              })
            )}
          </Card>

          <div style={{ marginTop: 16 }}>
            <CommentsPanel ownerType="task" ownerId={task.id} comments={comments} onChanged={load} title="Task comments" />
          </div>
        </div>

        <div className="side">
          <Card title="Project">
            <dl className="def-list">
              <dt>Machine</dt><dd>{project?.machineName || '—'}</dd>
              <dt>Code</dt><dd>{project?.code || '—'}</dd>
              <dt>Type</dt><dd>{project?.typeName || '—'}</dd>
              <dt>Serial</dt><dd>{project?.machineSerial || '—'}</dd>
              <dt>Responsible</dt><dd>{project?.responsibleName || '—'}</dd>
            </dl>
            <Link to={`/projects/${project?.id}`} className="btn btn-secondary btn-sm btn-block mt-8">
              <Icon name="projects" size={14} /> Open project
            </Link>
          </Card>

          <Card title="Task details" className="mt-16">
            <dl className="def-list">
              <dt>Status</dt><dd><StatusBadge status={task.status} label={taskStatusLabel(task.status)} /></dd>
              <dt>Role</dt><dd>{task.roleName || '—'}</dd>
              <dt>Assigned to</dt><dd>{task.assignedName || 'unassigned'}</dd>
              <dt>Duration</dt><dd>{durationText(task.estimatedDuration, task.durationUnit) || '—'}</dd>
              <dt>Planned</dt><dd>{fmtDate(task.plannedStart)} → {fmtDate(task.plannedEnd)}</dd>
              <dt>Started</dt><dd>{task.actualStart ? fmtDateTime(task.actualStart) : '—'}</dd>
              <dt>Actual end</dt><dd>{task.actualEnd ? fmtDateTime(task.actualEnd) : '—'}</dd>
              <dt>Dependencies</dt><dd>{(task.dependsOn || []).length} task(s)</dd>
            </dl>
            {task.description ? (
              <>
                <div className="divider" />
                <div className="small" style={{ whiteSpace: 'pre-wrap' }}>{task.description}</div>
              </>
            ) : null}
          </Card>

          <Card title={`Approvals (${approvals?.length || 0})`} className="mt-16">
            {sortedApprovals.length === 0 ? (
              <div className="small muted">No approval requests for this task.</div>
            ) : (
              sortedApprovals.map((a) => (
                <div className="evidence-item" key={a.id} style={{ display: 'block' }}>
                  <div className="flex between mb-8">
                    <span className="strong small">{a.scope === 'step' ? `Step: ${a.stepTitle}` : 'Task approval'}</span>
                    <StatusBadge status={a.status} />
                  </div>
                  <div className="small muted">
                    {a.submittedByName || '—'} · {fmtDateTime(a.submittedAt)}
                  </div>
                  {a.reviewedAt ? (
                    <div className="small muted">
                      {a.status === 'approved' ? 'Approved' : 'Rejected'} by {a.reviewedByName || '—'} · {fmtDateTime(a.reviewedAt)}
                    </div>
                  ) : null}
                  {a.reason ? <div className="small mt-8">Reason: {a.reason}</div> : null}
                  {a.status === 'submitted' && permissions.canReview ? (
                    <div className="flex mt-8" style={{ gap: 6 }}>
                      <button type="button" className="btn btn-success btn-sm" onClick={() => setReview({ approval: a, mode: 'approve' })}>
                        Approve
                      </button>
                      <button type="button" className="btn btn-danger-outline btn-sm" onClick={() => setReview({ approval: a, mode: 'reject' })}>
                        Reject
                      </button>
                    </div>
                  ) : null}
                </div>
              ))
            )}
          </Card>

          {pendingApprovals.length > 0 ? (
            <div className="info-block mt-16 small">
              {pendingApprovals.length} approval(s) waiting for review.
            </div>
          ) : null}

          <div style={{ marginTop: 16 }}>
            <AttachmentsPanel
              ownerType="task"
              ownerId={task.id}
              attachments={attachments}
              onChanged={load}
              title="Task files"
            />
          </div>
        </div>
      </div>

      {showTaskComplete ? (
        <CompleteModal
          title={`Complete task — ${task.name}`}
          path={`/tasks/${task.id}/complete`}
          approvalRequired={!!task.approvalRequired}
          canOverride={canOverride}
          onClose={() => setShowTaskComplete(false)}
          onSaved={load}
        />
      ) : null}

      {review ? (
        <ReviewModal
          approval={review.approval}
          mode={review.mode}
          onClose={() => setReview(null)}
          onDone={load}
        />
      ) : null}
    </div>
  );
}

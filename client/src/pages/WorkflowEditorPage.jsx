// Workflow template editor (spec section 6): tasks, steps, requirements, evidence & measurement config.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Card, Icon, Loading, ErrorBlock, Field, Empty } from '../components/ui.jsx';
import { classNames } from '../utils.js';

const UNITS = [
  { key: 'minutes', label: 'Minutes' },
  { key: 'hours', label: 'Hours' },
  { key: 'days', label: 'Days' }
];

let seq = 0;
const tmpId = (prefix) => `${prefix}_t${Date.now().toString(36)}${(seq += 1)}`;

function newStep(order) {
  return {
    id: tmpId('wts'),
    title: '', description: '', instructions: '',
    estimatedDuration: 0, durationUnit: 'days', roleId: null,
    materials: [], components: [], tools: [],
    evidenceRequired: false, evidenceTypes: [], minFiles: 1, maxFiles: null,
    measurement: { enabled: false, name: '', expected: null, tolerance: 0, unit: '', required: true },
    approvalRequired: false, notes: ''
  };
}

function newTask(order) {
  return {
    id: tmpId('wtt'),
    name: '', description: '', roleId: null,
    estimatedDuration: 1, durationUnit: 'days',
    approvalRequired: false, sequentialSteps: true,
    dependsOn: [], materials: [], components: [], tools: [], steps: []
  };
}

// ------------------------------------------------------------------ requirement rows

function ReqRows({ idKey, rows, options, onChange, label }) {
  const add = () => onChange([...rows, { [idKey]: '', quantity: 1, unit: '', notes: '' }]);
  const patch = (i, p) => onChange(rows.map((r, j) => (j === i ? { ...r, ...p } : r)));
  const remove = (i) => onChange(rows.filter((_, j) => j !== i));

  return (
    <Field label={label}>
      <div>
        {rows.map((r, i) => (
          <div className="req-row" key={i}>
            <select className="select" value={r[idKey] || ''} onChange={(e) => {
              const item = options.find((o) => o.id === e.target.value);
              patch(i, { [idKey]: e.target.value, unit: r.unit || item?.unit || '' });
            }}>
              <option value="">— select —</option>
              {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
            </select>
            <input type="number" min="0" step="any" className="input" value={r.quantity ?? 1} onChange={(e) => patch(i, { quantity: e.target.value })} title="Quantity" />
            <input className="input" value={r.unit || ''} onChange={(e) => patch(i, { unit: e.target.value })} placeholder="unit" title="Unit" />
            <button type="button" className="icon-btn rm" title="Remove" onClick={() => remove(i)}><Icon name="trash" size={14} /></button>
          </div>
        ))}
        <button type="button" className="btn btn-secondary btn-sm" onClick={add}><Icon name="plus" size={13} /> Add</button>
      </div>
    </Field>
  );
}

// ------------------------------------------------------------------ step editor

function StepEditor({ step, index, total, refs, onChange, onMove, onRemove }) {
  const [open, setOpen] = useState(false);
  const patch = (p) => onChange({ ...step, ...p });
  const m = step.measurement || {};

  return (
    <div className="card" style={{ marginBottom: 10 }}>
      <div className="card-body" style={{ padding: '10px 14px' }}>
        <div className="flex between" style={{ gap: 8 }}>
          <button type="button" className="wf-task grow" style={{ border: 'none', background: 'transparent', padding: 0 }} onClick={() => setOpen(!open)}>
            <span className="idx">{index + 1}</span>
            <span className="grow">
              <span className="name">{step.title || `Step ${index + 1}`}</span>
              <span className="sub" style={{ display: 'block' }}>
                {step.evidenceRequired ? `evidence ${step.minFiles || 1}${step.maxFiles ? `–${step.maxFiles}` : '+'}` : 'no evidence required'}
                {m.enabled ? ` · measurement${m.required ? ' (required)' : ''}` : ''}
                {step.approvalRequired ? ' · approval' : ''}
              </span>
            </span>
            <Icon name={open ? 'chevronDown' : 'chevronRight'} size={15} />
          </button>
          <div className="flex" style={{ gap: 2, flexShrink: 0 }}>
            <button type="button" className="icon-btn" disabled={index === 0} onClick={() => onMove(-1)}><Icon name="chevronDown" size={14} style={{ transform: 'rotate(180deg)' }} /></button>
            <button type="button" className="icon-btn" disabled={index === total - 1} onClick={() => onMove(1)}><Icon name="chevronDown" size={14} /></button>
            <button type="button" className="icon-btn" onClick={onRemove}><Icon name="trash" size={14} /></button>
          </div>
        </div>

        {open ? (
          <div className="mt-16">
            <div className="input-row">
              <Field label="Step title" className="grow">
                <input className="input" value={step.title} onChange={(e) => patch({ title: e.target.value })} />
              </Field>
              <Field label="Role">
                <select className="select" value={step.roleId || ''} onChange={(e) => patch({ roleId: e.target.value || null })}>
                  <option value="">— None —</option>
                  {refs.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
                </select>
              </Field>
            </div>
            <Field label="Description">
              <textarea className="textarea" rows="2" value={step.description} onChange={(e) => patch({ description: e.target.value })} />
            </Field>
            <Field label="Work instructions (shown to the technician)">
              <textarea className="textarea" rows="3" value={step.instructions} onChange={(e) => patch({ instructions: e.target.value })} />
            </Field>
            <div className="input-row">
              <Field label="Est. duration">
                <input type="number" min="0" step="0.5" className="input" value={step.estimatedDuration} onChange={(e) => patch({ estimatedDuration: e.target.value })} />
              </Field>
              <Field label="Unit">
                <select className="select" value={step.durationUnit} onChange={(e) => patch({ durationUnit: e.target.value })}>
                  {UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
                </select>
              </Field>
            </div>

            <ReqRows idKey="materialId" label="Materials" rows={step.materials} options={refs.materials} onChange={(rows) => patch({ materials: rows })} />
            <ReqRows idKey="componentId" label="Components" rows={step.components} options={refs.components} onChange={(rows) => patch({ components: rows })} />
            <ReqRows idKey="toolId" label="Tools" rows={step.tools} options={refs.tools} onChange={(rows) => patch({ tools: rows })} />

            <div className="divider" />
            <label className="checkbox-row">
              <input type="checkbox" checked={!!step.evidenceRequired} onChange={(e) => patch({ evidenceRequired: e.target.checked })} />
              Evidence required before the step can be completed
            </label>
            {step.evidenceRequired ? (
              <>
                <div className="input-row">
                  <Field label="Minimum files">
                    <input type="number" min="0" className="input" value={step.minFiles ?? 1} onChange={(e) => patch({ minFiles: e.target.value })} />
                  </Field>
                  <Field label="Maximum files (empty = no limit)">
                    <input type="number" min="0" className="input" value={step.maxFiles ?? ''} onChange={(e) => patch({ maxFiles: e.target.value === '' ? null : e.target.value })} />
                  </Field>
                </div>
                <Field label="Allowed evidence types (empty = any)">
                  <div className="flex flex-wrap" style={{ gap: 8 }}>
                    {refs.evidenceTypes.filter((t) => t.active !== false).map((t) => {
                      const ek = t.key || t.code || t.name;
                      const checked = (step.evidenceTypes || []).includes(ek);
                      return (
                        <label key={t.id} className="checkbox-row" style={{ border: '1px solid var(--border)', borderRadius: 999, padding: '3px 10px' }}>
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => patch({
                              evidenceTypes: checked
                                ? step.evidenceTypes.filter((k) => k !== ek)
                                : [...(step.evidenceTypes || []), ek]
                            })}
                          />
                          {t.label || t.name}
                        </label>
                      );
                    })}
                  </div>
                </Field>
              </>
            ) : null}

            <div className="divider" />
            <label className="checkbox-row">
              <input type="checkbox" checked={!!m.enabled} onChange={(e) => patch({ measurement: { ...m, enabled: e.target.checked } })} />
              Measurement with tolerance check
            </label>
            {m.enabled ? (
              <>
                <div className="input-row">
                  <Field label="Measurement name" className="grow">
                    <input className="input" value={m.name || ''} onChange={(e) => patch({ measurement: { ...m, name: e.target.value } })} placeholder="e.g. Sensor distance" />
                  </Field>
                  <Field label="Unit">
                    <input className="input" value={m.unit || ''} onChange={(e) => patch({ measurement: { ...m, unit: e.target.value } })} placeholder="mm" />
                  </Field>
                </div>
                <div className="input-row">
                  <Field label="Expected value">
                    <input type="number" step="any" className="input" value={m.expected ?? ''} onChange={(e) => patch({ measurement: { ...m, expected: e.target.value === '' ? null : e.target.value } })} />
                  </Field>
                  <Field label="Tolerance ±">
                    <input type="number" step="any" className="input" value={m.tolerance ?? 0} onChange={(e) => patch({ measurement: { ...m, tolerance: e.target.value } })} />
                  </Field>
                </div>
                <label className="checkbox-row">
                  <input type="checkbox" checked={m.required !== false} onChange={(e) => patch({ measurement: { ...m, required: e.target.checked } })} />
                  A PASS measurement is mandatory to complete the step
                </label>
              </>
            ) : null}

            <div className="divider" />
            <label className="checkbox-row">
              <input type="checkbox" checked={!!step.approvalRequired} onChange={(e) => patch({ approvalRequired: e.target.checked })} />
              This step requires approval after completion
            </label>
            <Field label="Notes">
              <input className="input" value={step.notes || ''} onChange={(e) => patch({ notes: e.target.value })} />
            </Field>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// ------------------------------------------------------------------ task editor

function TaskEditor({ task, index, total, refs, allTasks, onChange, onMove, onRemove, defaultOpen }) {
  const [open, setOpen] = useState(!!defaultOpen);
  const patch = (p) => onChange({ ...task, ...p });

  const moveStep = (i, dir) => {
    const steps = [...task.steps];
    const j = i + dir;
    if (j < 0 || j >= steps.length) return;
    [steps[i], steps[j]] = [steps[j], steps[i]];
    patch({ steps });
  };

  return (
    <Card
      className="mb-16"
      title={(
        <button type="button" className="flex grow" style={{ border: 'none', background: 'transparent', gap: 8, cursor: 'pointer', textAlign: 'left' }} onClick={() => setOpen(!open)}>
          <Icon name={open ? 'chevronDown' : 'chevronRight'} size={15} />
          <span>{index + 1}. {task.name || `Task ${index + 1}`}</span>
          <span className="badge badge-slate">{task.steps.length} step(s)</span>
          {task.approvalRequired ? <span className="badge badge-purple">approval</span> : null}
        </button>
      )}
      actions={(
        <div className="flex" style={{ gap: 2 }}>
          <button type="button" className="icon-btn" disabled={index === 0} title="Move up" onClick={() => onMove(-1)}><Icon name="chevronDown" size={14} style={{ transform: 'rotate(180deg)' }} /></button>
          <button type="button" className="icon-btn" disabled={index === total - 1} title="Move down" onClick={() => onMove(1)}><Icon name="chevronDown" size={14} /></button>
          <button type="button" className="icon-btn" title="Delete task" onClick={onRemove}><Icon name="trash" size={15} /></button>
        </div>
      )}
    >
      {open ? (
        <div>
          <div className="input-row">
            <Field label="Task name" className="grow">
              <input className="input" value={task.name} onChange={(e) => patch({ name: e.target.value })} />
            </Field>
            <Field label="Default role">
              <select className="select" value={task.roleId || ''} onChange={(e) => patch({ roleId: e.target.value || null })}>
                <option value="">— None —</option>
                {refs.roles.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}
              </select>
            </Field>
          </div>
          <Field label="Description">
            <textarea className="textarea" rows="2" value={task.description} onChange={(e) => patch({ description: e.target.value })} />
          </Field>
          <div className="input-row">
            <Field label="Est. duration">
              <input type="number" min="0" step="0.5" className="input" value={task.estimatedDuration} onChange={(e) => patch({ estimatedDuration: e.target.value })} />
            </Field>
            <Field label="Unit">
              <select className="select" value={task.durationUnit} onChange={(e) => patch({ durationUnit: e.target.value })}>
                {UNITS.map((u) => <option key={u.key} value={u.key}>{u.label}</option>)}
              </select>
            </Field>
          </div>

          <ReqRows idKey="materialId" label="Task-level materials" rows={task.materials} options={refs.materials} onChange={(rows) => patch({ materials: rows })} />
          <ReqRows idKey="componentId" label="Task-level components" rows={task.components} options={refs.components} onChange={(rows) => patch({ components: rows })} />
          <ReqRows idKey="toolId" label="Task-level tools" rows={task.tools} options={refs.tools} onChange={(rows) => patch({ tools: rows })} />

          {allTasks.length > 1 ? (
            <Field label="Depends on (tasks that must finish first)">
              <div className="flex flex-wrap" style={{ gap: 8 }}>
                {allTasks.filter((t) => t.id !== task.id).map((t, i) => {
                  const checked = (task.dependsOn || []).includes(t.id);
                  return (
                    <label key={t.id} className="checkbox-row" style={{ border: '1px solid var(--border)', borderRadius: 999, padding: '3px 10px' }}>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => patch({
                          dependsOn: checked
                            ? task.dependsOn.filter((x) => x !== t.id)
                            : [...(task.dependsOn || []), t.id]
                        })}
                      />
                      {t.name || `Task`}
                    </label>
                  );
                })}
              </div>
            </Field>
          ) : null}

          <div className="flex" style={{ gap: 18, flexWrap: 'wrap', margin: '8px 0' }}>
            <label className="checkbox-row">
              <input type="checkbox" checked={!!task.approvalRequired} onChange={(e) => patch({ approvalRequired: e.target.checked })} />
              Task requires approval when completed
            </label>
            <label className="checkbox-row">
              <input type="checkbox" checked={task.sequentialSteps !== false} onChange={(e) => patch({ sequentialSteps: e.target.checked })} />
              Steps must be done in order
            </label>
          </div>

          <div className="divider" />
          <div className="flex between mb-8">
            <span className="strong">Steps ({task.steps.length})</span>
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => patch({ steps: [...task.steps, newStep(task.steps.length + 1)] })}>
              <Icon name="plus" size={13} /> Add step
            </button>
          </div>
          {task.steps.length === 0 ? (
            <div className="small muted">No steps — the task can be completed directly.</div>
          ) : (
            task.steps.map((s, i) => (
              <StepEditor
                key={s.id}
                step={s}
                index={i}
                total={task.steps.length}
                refs={refs}
                onChange={(next) => patch({ steps: task.steps.map((x, j) => (j === i ? next : x)) })}
                onMove={(dir) => moveStep(i, dir)}
                onRemove={() => patch({ steps: task.steps.filter((_, j) => j !== i) })}
              />
            ))
          )}
        </div>
      ) : null}
    </Card>
  );
}

// ------------------------------------------------------------------ page

const EMPTY_REFS = { users: [], roles: [], materials: [], components: [], tools: [], evidenceTypes: [], projectTypes: [] };

export default function WorkflowEditorPage() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { show, confirm } = useToast();

  const [refs, setRefs] = useState(EMPTY_REFS);
  const [draft, setDraft] = useState(null);
  const [savedJson, setSavedJson] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    (async () => {
      try {
        const [users, roles, materials, components, tools, evidenceTypes, projectTypes] = await Promise.all([
          api.get('/users').catch(() => []),
          api.get('/roles').catch(() => []),
          api.get('/materials').catch(() => []),
          api.get('/components').catch(() => []),
          api.get('/tools').catch(() => []),
          api.get('/evidence-types').catch(() => []),
          api.get('/project-types').catch(() => [])
        ]);
        setRefs({ users, roles, materials, components, tools, evidenceTypes, projectTypes });
      } catch { /* refs stay empty */ }
    })();
  }, []);

  const load = useCallback(async () => {
    if (isNew) {
      const blank = { name: '', description: '', projectTypeId: '', active: true, tasks: [] };
      setDraft(blank);
      setSavedJson('');
      return;
    }
    try {
      const t = await api.get(`/workflow-templates/${id}`);
      setDraft({
        name: t.name, description: t.description || '', projectTypeId: t.projectTypeId,
        active: t.active !== false, tasks: t.tasks || []
      });
      setSavedJson(JSON.stringify({ name: t.name, description: t.description || '', projectTypeId: t.projectTypeId, active: t.active !== false, tasks: t.tasks || [] }));
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, [id, isNew]);

  useEffect(() => { load(); }, [load]);

  const dirty = useMemo(() => !!draft && JSON.stringify(draft) !== savedJson, [draft, savedJson]);
  const canManage = hasPermission('workflow.manage');

  const patch = (p) => setDraft((d) => ({ ...d, ...p }));

  const moveTask = (i, dir) => {
    const tasks = [...draft.tasks];
    const j = i + dir;
    if (j < 0 || j >= tasks.length) return;
    [tasks[i], tasks[j]] = [tasks[j], tasks[i]];
    patch({ tasks });
  };

  const save = async () => {
    if (!draft.name.trim()) { show('Template name is required', 'error'); return; }
    if (!draft.projectTypeId) { show('Select a project type', 'error'); return; }
    setBusy(true);
    try {
      const payload = {
        name: draft.name.trim(),
        description: draft.description || '',
        projectTypeId: draft.projectTypeId,
        active: draft.active !== false,
        tasks: draft.tasks
      };
      const result = isNew
        ? await api.post('/workflow-templates', payload)
        : await api.put(`/workflow-templates/${id}`, payload);
      show('Template saved', 'success');
      if (isNew) navigate(`/workflows/${result.id}`, { replace: true });
      else {
        setDraft({ name: result.name, description: result.description || '', projectTypeId: result.projectTypeId, active: result.active !== false, tasks: result.tasks || [] });
        setSavedJson(JSON.stringify({ name: result.name, description: result.description || '', projectTypeId: result.projectTypeId, active: result.active !== false, tasks: result.tasks || [] }));
      }
    } catch (err) {
      show(err.message, 'error');
    } finally {
      setBusy(false);
    }
  };

  const duplicate = async () => {
    try {
      const copy = await api.post(`/workflow-templates/${id}/duplicate`);
      show('Template duplicated', 'success');
      navigate(`/workflows/${copy.id}`);
    } catch (err) {
      show(err.message, 'error');
    }
  };

  const remove = async () => {
    const ok = await confirm({
      title: `Delete template "${draft.name}"?`,
      message: 'Existing projects keep their own copy — only the template is deleted.',
      confirmLabel: 'Delete template'
    });
    if (!ok) return;
    try {
      await api.del(`/workflow-templates/${id}`);
      show('Template deleted', 'success');
      navigate('/workflows');
    } catch (err) {
      show(err.message, 'error');
    }
  };

  if (error) return <ErrorBlock message={error} />;
  if (!draft) return <Loading />;

  return (
    <div>
      <div className="page-header">
        <div className="grow">
          <Link to="/workflows" className="small" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
            <Icon name="back" size={13} /> All templates
          </Link>
          <h1>{isNew ? 'New workflow template' : draft.name || 'Workflow template'}</h1>
          <div className="sub">
            Templates are copied into a project when it is created — later edits here do not change running projects.
          </div>
        </div>
        <div className="flex flex-wrap">
          {dirty ? <span className="badge badge-amber">unsaved changes</span> : null}
          {!isNew && canManage ? (
            <>
              <button type="button" className="btn btn-secondary" onClick={duplicate}><Icon name="folder" size={14} /> Duplicate</button>
              <button type="button" className="btn btn-danger-outline" onClick={remove}><Icon name="trash" size={14} /> Delete</button>
            </>
          ) : null}
          {canManage ? (
            <button type="button" className="btn btn-primary" disabled={busy || (!dirty && !isNew)} onClick={save}>
              <Icon name="check" size={14} /> {busy ? 'Saving…' : 'Save template'}
            </button>
          ) : null}
        </div>
      </div>

      <div className="split">
        <div className="col">
          <Card title={`Tasks (${draft.tasks.length})`} actions={(
            <button type="button" className="btn btn-secondary btn-sm" onClick={() => patch({ tasks: [...draft.tasks, newTask(draft.tasks.length + 1)] })}>
              <Icon name="plus" size={13} /> Add task
            </button>
          )}>
            {draft.tasks.length === 0 ? (
              <Empty icon="workflow" title="No tasks yet" hint="Add the first task of this workflow." />
            ) : (
              draft.tasks.map((t, i) => (
                <TaskEditor
                  key={t.id}
                  task={t}
                  index={i}
                  total={draft.tasks.length}
                  refs={refs}
                  allTasks={draft.tasks}
                  defaultOpen={draft.tasks.length === 1}
                  onChange={(next) => patch({ tasks: draft.tasks.map((x, j) => (j === i ? next : x)) })}
                  onMove={(dir) => moveTask(i, dir)}
                  onRemove={() => patch({ tasks: draft.tasks.filter((_, j) => j !== i) })}
                />
              ))
            )}
          </Card>
        </div>

        <div className="side">
          <Card title="Template details">
            <Field label="Name *">
              <input className="input" value={draft.name} onChange={(e) => patch({ name: e.target.value })} />
            </Field>
            <Field label="Project type *">
              <select className="select" value={draft.projectTypeId} onChange={(e) => patch({ projectTypeId: e.target.value })}>
                <option value="">— Select —</option>
                {refs.projectTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
            </Field>
            <Field label="Description">
              <textarea className="textarea" rows="3" value={draft.description} onChange={(e) => patch({ description: e.target.value })} />
            </Field>
            <label className="checkbox-row">
              <input type="checkbox" checked={draft.active !== false} onChange={(e) => patch({ active: e.target.checked })} />
              Template is active (selectable for new projects)
            </label>
          </Card>

          <div className="info-block mt-16 small">
            <Icon name="workflow" size={14} /> Requirements (materials, components, tools) defined per step are automatically copied to the project tasks and shown to the technician.
          </div>
        </div>
      </div>

      {canManage ? (
        <div className="flex mt-16">
          <button type="button" className="btn btn-primary" disabled={busy || (!dirty && !isNew)} onClick={save}>
            <Icon name="check" size={14} /> {busy ? 'Saving…' : 'Save template'}
          </button>
        </div>
      ) : null}
    </div>
  );
}

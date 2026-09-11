// Create / edit project modal (spec section 22-23).
import { useMemo, useState } from 'react';
import { api } from '../api.js';
import { useToast } from '../context/ToastContext.jsx';
import { Modal, Field } from './ui.jsx';
import { toDateInput } from '../utils.js';

export default function ProjectFormModal({ project, refs, onClose, onSaved }) {
  const { show } = useToast();
  const isEdit = !!project?.id;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [form, setForm] = useState(() => ({
    machineName: project?.machineName || '',
    machineReference: project?.machineReference || '',
    machineSerial: project?.machineSerial || '',
    projectTypeId: project?.projectTypeId || '',
    templateId: project?.templateId || '',
    description: project?.description || '',
    productionLine: project?.productionLine || '',
    departmentId: project?.departmentId || '',
    locationId: project?.locationId || '',
    responsibleUserId: project?.responsibleUserId || '',
    startDate: toDateInput(project?.startDate || new Date().toISOString()),
    plannedEndDate: toDateInput(project?.plannedEndDate),
    priority: project?.priority || 'medium',
    status: project?.status || 'planned'
  }));

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));

  const templatesForType = useMemo(() => {
    if (!form.projectTypeId) return refs.templates;
    return refs.templates.filter((t) => t.projectTypeId === form.projectTypeId);
  }, [refs.templates, form.projectTypeId]);

  const submit = async (e) => {
    e.preventDefault();
    setError('');
    if (!form.machineName.trim()) { setError('Machine name is required.'); return; }
    if (!isEdit && !form.projectTypeId) { setError('Project type is required.'); return; }
    if (!isEdit && !form.templateId) { setError('A workflow template is required. Pick a project type that has an active template.'); return; }

    setBusy(true);
    try {
      const payload = {
        machineName: form.machineName.trim(),
        machineReference: form.machineReference.trim(),
        machineSerial: form.machineSerial.trim(),
        description: form.description.trim(),
        productionLine: form.productionLine.trim(),
        departmentId: form.departmentId || null,
        locationId: form.locationId || null,
        responsibleUserId: form.responsibleUserId || null,
        priority: form.priority,
        status: form.status
      };
      if (isEdit) {
        payload.projectTypeId = form.projectTypeId || undefined;
        if (form.startDate) payload.startDate = new Date(form.startDate).toISOString();
        if (form.plannedEndDate) payload.plannedEndDate = new Date(form.plannedEndDate).toISOString();
        const saved = await api.put(`/projects/${project.id}`, payload);
        show('Project updated', 'success');
        onSaved?.(saved);
      } else {
        payload.projectTypeId = form.projectTypeId;
        payload.templateId = form.templateId;
        if (form.startDate) payload.startDate = new Date(form.startDate).toISOString();
        const saved = await api.post('/projects', payload);
        show(`Project ${saved.code} created with ${saved.tasks?.length ?? 0} task(s)`, 'success');
        onSaved?.(saved);
      }
      onClose();
    } catch (err) {
      setError(err.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      title={isEdit ? `Edit project ${project.code}` : 'New machine project'}
      onClose={onClose}
      size="modal-lg"
      footer={(
        <>
          <button type="button" className="btn btn-secondary" onClick={onClose}>Cancel</button>
          <button type="submit" form="project-form" className="btn btn-primary" disabled={busy}>
            {busy ? 'Saving…' : (isEdit ? 'Save changes' : 'Create project')}
          </button>
        </>
      )}
    >
      <form id="project-form" onSubmit={submit}>
        {error ? <div className="error-block">{error}</div> : null}

        <div className="input-row">
          <Field label="Machine name *">
            <input className="input" value={form.machineName} onChange={set('machineName')} placeholder="e.g. JUKI 224EN" />
          </Field>
          <Field label="Machine reference">
            <input className="input" value={form.machineReference} onChange={set('machineReference')} placeholder="e.g. JUKI-224EN-01" />
          </Field>
        </div>

        <div className="input-row">
          <Field label="Serial number">
            <input className="input" value={form.machineSerial} onChange={set('machineSerial')} placeholder="e.g. SN-224EN-8891" />
          </Field>
          <Field label="Production line">
            <input className="input" value={form.productionLine} onChange={set('productionLine')} placeholder="e.g. Line 1" />
          </Field>
        </div>

        <div className="input-row">
          <Field label="Project type *">
            <select className="select" value={form.projectTypeId} onChange={(e) => setForm((f) => ({ ...f, projectTypeId: e.target.value, templateId: '' }))}>
              <option value="">— Select type —</option>
              {refs.projectTypes.filter((t) => t.active !== false).map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
          {!isEdit ? (
            <Field label="Workflow template *" hint="Tasks and steps are copied from the template into the project.">
              <select className="select" value={form.templateId} onChange={set('templateId')}>
                <option value="">— Select template —</option>
                {templatesForType.map((t) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.taskCount} tasks)</option>
                ))}
              </select>
            </Field>
          ) : null}
        </div>

        <Field label="Description">
          <textarea className="textarea" value={form.description} onChange={set('description')} placeholder="Short description of the work to be done" />
        </Field>

        <div className="input-row">
          <Field label="Department">
            <select className="select" value={form.departmentId} onChange={set('departmentId')}>
              <option value="">— None —</option>
              {refs.departments.filter((d) => d.active !== false).map((d) => <option key={d.id} value={d.id}>{d.name}</option>)}
            </select>
          </Field>
          <Field label="Location">
            <select className="select" value={form.locationId} onChange={set('locationId')}>
              <option value="">— None —</option>
              {refs.locations.filter((l) => l.active !== false).map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
            </select>
          </Field>
        </div>

        <div className="input-row">
          <Field label="Responsible person">
            <select className="select" value={form.responsibleUserId} onChange={set('responsibleUserId')}>
              <option value="">— None —</option>
              {refs.users.filter((u) => u.active !== false).map((u) => (
                <option key={u.id} value={u.id}>{`${u.firstName || ''} ${u.lastName || ''}`.trim() || u.username}</option>
              ))}
            </select>
          </Field>
          <Field label="Priority">
            <select className="select" value={form.priority} onChange={set('priority')}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </Field>
        </div>

        <div className="input-row">
          <Field label={isEdit ? 'Start date' : 'Start date (planned dates of tasks are calculated from here)'}>
            <input type="date" className="input" value={form.startDate} onChange={set('startDate')} />
          </Field>
          {isEdit ? (
            <Field label="Planned end date">
              <input type="date" className="input" value={form.plannedEndDate} onChange={set('plannedEndDate')} />
            </Field>
          ) : null}
          <Field label="Status">
            <select className="select" value={form.status} onChange={set('status')}>
              <option value="planned">Planned</option>
              <option value="not_started">Not started</option>
              <option value="in_progress">In progress</option>
              <option value="waiting">Waiting</option>
              <option value="blocked">Blocked</option>
              <option value="validation">Validation</option>
              <option value="completed">Completed</option>
              <option value="cancelled">Cancelled</option>
            </select>
          </Field>
        </div>
      </form>
    </Modal>
  );
}

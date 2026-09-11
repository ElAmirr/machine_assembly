// Workflow templates list (spec section 6). Templates are copied into a project when it is created.
import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../api.js';
import { useAuth } from '../context/AuthContext.jsx';
import { useToast } from '../context/ToastContext.jsx';
import { Card, Icon, Loading, ErrorBlock, Empty } from '../components/ui.jsx';
import { fmtDateTime } from '../utils.js';

export default function WorkflowsPage() {
  const navigate = useNavigate();
  const { hasPermission } = useAuth();
  const { show, confirm } = useToast();
  const [rows, setRows] = useState(null);
  const [projectTypes, setProjectTypes] = useState([]);
  const [typeFilter, setTypeFilter] = useState('');
  const [error, setError] = useState('');

  const load = useCallback(async () => {
    try {
      const [templates, types] = await Promise.all([
        api.get('/workflow-templates'),
        api.get('/project-types').catch(() => [])
      ]);
      setRows(templates);
      setProjectTypes(types);
      setError('');
    } catch (err) {
      setError(err.message);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  const canManage = hasPermission('workflow.manage');
  const filtered = (rows || []).filter((t) => !typeFilter || t.projectTypeId === typeFilter);

  const duplicate = async (t) => {
    try {
      const copy = await api.post(`/workflow-templates/${t.id}/duplicate`);
      show('Template duplicated', 'success');
      navigate(`/workflows/${copy.id}`);
    } catch (err) {
      show(err.message, 'error');
    }
  };

  const toggleActive = async (t) => {
    try {
      await api.patch(`/workflow-templates/${t.id}/status`, { active: t.active === false });
      show(t.active === false ? 'Template activated' : 'Template deactivated', 'success');
      load();
    } catch (err) {
      show(err.message, 'error');
    }
  };

  const remove = async (t) => {
    const ok = await confirm({
      title: `Delete template "${t.name}"?`,
      message: 'Existing projects keep their own copy of the workflow — only the template is deleted.',
      confirmLabel: 'Delete template'
    });
    if (!ok) return;
    try {
      await api.del(`/workflow-templates/${t.id}`);
      show('Template deleted', 'success');
      load();
    } catch (err) {
      show(err.message, 'error');
    }
  };

  return (
    <div>
      <div className="page-header">
        <div className="grow">
          <h1>Workflow templates</h1>
          <div className="sub">Reusable task & step definitions — copied into each new project</div>
        </div>
        <div className="flex">
          <select className="select" style={{ width: 220 }} value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)}>
            <option value="">All project types</option>
            {projectTypes.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
          </select>
          {canManage ? (
            <button type="button" className="btn btn-primary" onClick={() => navigate('/workflows/new')}>
              <Icon name="plus" size={15} /> New template
            </button>
          ) : null}
        </div>
      </div>

      {error ? <ErrorBlock message={error} /> : null}
      {!rows ? <Loading /> : filtered.length === 0 ? (
        <Empty icon="workflow" title="No workflow templates" hint="Create a template to standardize how machines are built." />
      ) : (
        <div className="grid grid-2">
          {filtered.map((t) => (
            <Card
              key={t.id}
              className={t.active === false ? 'muted' : ''}
              title={(
                <span className="flex" style={{ gap: 8, alignItems: 'center' }}>
                  {t.name}
                  {t.active === false ? <span className="badge badge-slate">inactive</span> : <span className="badge badge-green">active</span>}
                </span>
              )}
              actions={(
                <div className="flex" style={{ gap: 4 }}>
                  <button type="button" className="btn btn-secondary btn-sm" onClick={() => navigate(`/workflows/${t.id}`)}>
                    <Icon name="edit" size={13} /> Open
                  </button>
                  {canManage ? (
                    <>
                      <button type="button" className="icon-btn" title="Duplicate" onClick={() => duplicate(t)}><Icon name="folder" size={15} /></button>
                      <button type="button" className="icon-btn" title={t.active === false ? 'Activate' : 'Deactivate'} onClick={() => toggleActive(t)}>
                        <Icon name={t.active === false ? 'checkCircle' : 'x'} size={15} />
                      </button>
                      <button type="button" className="icon-btn" title="Delete" onClick={() => remove(t)}><Icon name="trash" size={15} /></button>
                    </>
                  ) : null}
                </div>
              )}
            >
              <div className="small muted mb-8">{t.projectTypeName || '—'}</div>
              {t.description ? <p className="small" style={{ whiteSpace: 'pre-wrap' }}>{t.description}</p> : null}
              <div className="flex flex-wrap mt-8" style={{ gap: 8 }}>
                <span className="badge badge-blue">{t.taskCount} task(s)</span>
                <span className="badge badge-slate">{t.stepCount} step(s)</span>
              </div>
              <div className="small muted mt-8">Updated {fmtDateTime(t.updatedAt || t.createdAt)}</div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
